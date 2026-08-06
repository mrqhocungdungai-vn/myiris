import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Group, Mesh } from "three";
import { deriveWebglSettings } from "../lib/webgl-quality";
import "../styles/reactor.css";

type ReactorState = "idle" | "online" | "listening" | "speaking" | "replying" | "working";

type Palette = {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
};

const PALETTES: Record<ReactorState, Palette> = {
  idle: { primary: "120, 170, 150", secondary: "150, 185, 165", accent: "210, 225, 218", glow: "150, 205, 180" },
  online: { primary: "18, 163, 148", secondary: "70, 200, 175", accent: "230, 255, 248", glow: "60, 195, 170" },
  listening: { primary: "40, 205, 170", secondary: "18, 163, 148", accent: "236, 255, 250", glow: "70, 214, 185" },
  speaking: { primary: "238, 122, 92", secondary: "255, 188, 108", accent: "255, 250, 230", glow: "255, 154, 104" },
  // Listen-only mode's silent reply (replace-listening-mode-with-listen-only
  // design.md D6): a cool blue, distinct in hue from listening's teal-green
  // and never the warm speaking accent, at speaking's full energy.
  replying: { primary: "72, 140, 232", secondary: "110, 175, 250", accent: "225, 238, 255", glow: "95, 165, 245" },
  working: { primary: "120, 180, 120", secondary: "40, 200, 170", accent: "252, 255, 230", glow: "130, 195, 150" },
};

function rgbToColor(rgb: string) {
  const [r, g, b] = rgb.split(",").map((n) => parseFloat(n) / 255);
  return new THREE.Color(r, g, b);
}

// Single source of the per-state accent color (design.md D3) — CenterStage
// and HudShell both read this instead of each hand-writing their own copy.
export const ORB_ACCENT: Record<ReactorState, string> = Object.fromEntries(
  (Object.entries(PALETTES) as [ReactorState, Palette][]).map(([state, palette]) => [state, palette.primary]),
) as Record<ReactorState, string>;

// Pre-parsed once at module scope so the per-frame render loop never
// allocates a THREE.Color — see openspec/changes/unstall-render-and-audio.
const PALETTE_COLORS: Record<ReactorState, { primary: THREE.Color; secondary: THREE.Color; accent: THREE.Color; glow: THREE.Color }> =
  Object.fromEntries(
    (Object.entries(PALETTES) as [ReactorState, Palette][]).map(([state, palette]) => [
      state,
      {
        primary: rgbToColor(palette.primary),
        secondary: rgbToColor(palette.secondary),
        accent: rgbToColor(palette.accent),
        glow: rgbToColor(palette.glow),
      },
    ])
  ) as Record<ReactorState, { primary: THREE.Color; secondary: THREE.Color; accent: THREE.Color; glow: THREE.Color }>;

// Scratch Vector3 reused every frame for the scale lerp (design D2).
const _scaleVec = new THREE.Vector3();

// Exported so the light path's CSS glow (design.md D3) can vary its opacity
// with the same per-state energy the scene itself animates toward.
export const ORB_ENERGY: Record<ReactorState, number> = {
  idle: 0.18,
  online: 0.45,
  listening: 0.72,
  speaking: 1,
  replying: 1,
  working: 0.88,
};

function targetEnergy(s: ReactorState) {
  return ORB_ENERGY[s];
}

// Steps a value toward its target — or lands on it outright while the loop is
// paused. Paused draws one frame per change, so a per-frame step would strand
// the orb part-way to the state it is meant to depict: a still orb showing a
// colour between two states is as wrong as a blank one (design.md — settle vs
// freeze).
function approach(current: number, target: number, factor: number, paused: boolean) {
  return paused ? target : current + (target - current) * factor;
}

type Ripple = { start: number; kind: "wake" | "heard" };
const MAX_RIPPLES = 4;

function Ripples({ ripplesRef }: { ripplesRef: { current: Ripple[] } }) {
  const meshRefs = useRef<Array<Mesh | null>>([]);

  useFrame(() => {
    const now = performance.now();
    ripplesRef.current = ripplesRef.current.filter((r) => now - r.start < (r.kind === "wake" ? 750 : 620));
    const active = ripplesRef.current.slice(-MAX_RIPPLES);

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      const ripple = active[i];
      if (!ripple) {
        mesh.visible = false;
        continue;
      }
      const life = ripple.kind === "wake" ? 750 : 620;
      const p = (now - ripple.start) / life;
      const ease = 1 - Math.pow(1 - p, 3);
      const radius = 0.5 + (ripple.kind === "wake" ? 1.2 : 0.85) * ease;
      const alpha = (1 - p) * (ripple.kind === "wake" ? 0.75 : 0.5);
      mesh.visible = true;
      mesh.scale.setScalar(radius);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = alpha;
      material.color.copy(ripple.kind === "wake" ? PALETTE_COLORS.online.secondary : PALETTE_COLORS.online.accent);
    }
  });

  return (
    <>
      {Array.from({ length: MAX_RIPPLES }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          visible={false}
        >
          <ringGeometry args={[0.95, 1, 48]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function ArcReactorScene({
  state,
  inputLevelRef,
  outputLevelRef,
  thinking,
  ripplesRef,
  rotationRef,
  scaleRef,
  unlit,
  running,
}: {
  state: ReactorState;
  inputLevelRef?: { current: number };
  outputLevelRef?: { current: number };
  thinking: boolean;
  ripplesRef: { current: Ripple[] };
  rotationRef?: { current: { x: number; y: number } };
  scaleRef?: { current: number };
  /** Light path (design.md D1/D4): rings use materials that need no scene lighting. */
  unlit: boolean;
  /** False while the loop is paused — the scene then draws on change, not per frame. */
  running: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const coreRef = useRef<Mesh>(null);
  const ring1Ref = useRef<Mesh>(null);
  const ring2Ref = useRef<Mesh>(null);
  const outerRef = useRef<Mesh>(null);
  const sparkRefs = useRef<Array<Mesh | null>>([]);

  const energyRef = useRef(0);
  const inRef = useRef(0);
  const outRef = useRef(0);
  const thinkingAlphaRef = useRef(0);

  // Nothing in this scene's JSX changes with `state` — every colour and scale
  // is written from inside useFrame — so r3f has no prop change to invalidate
  // on. A paused orb must therefore ask for the one frame that repaints it into
  // the state it now depicts.
  const invalidate = useThree((three) => three.invalidate);
  useEffect(() => {
    if (!running) invalidate();
  }, [running, state, thinking, unlit, invalidate]);

  useFrame((threeState, delta) => {
    const paused = !running;
    const pc = PALETTE_COLORS[state];
    energyRef.current = approach(energyRef.current, targetEnergy(state), 0.06, paused);
    const inTarget = inputLevelRef ? Math.max(0, Math.min(1, inputLevelRef.current)) : 0;
    const outTarget = outputLevelRef ? Math.max(0, Math.min(1, outputLevelRef.current)) : 0;
    inRef.current = approach(inRef.current, inTarget, 0.35, paused);
    outRef.current = approach(outRef.current, outTarget, 0.35, paused);
    const energy = energyRef.current;
    const t = threeState.clock.elapsedTime;

    if (groupRef.current) {
      const targetX = rotationRef?.current.x ?? 0;
      const targetY = rotationRef?.current.y ?? 0;
      groupRef.current.rotation.x = approach(groupRef.current.rotation.x, targetX, 0.1, paused);
      // The delta term is idle drift, an animation — a paused frame lands on
      // the gesture target without advancing it.
      groupRef.current.rotation.y =
        approach(groupRef.current.rotation.y, targetY, 0.1, paused) + (paused ? 0 : delta * 0.02);
      const targetScale = scaleRef?.current ?? 1;
      _scaleVec.set(targetScale, targetScale, targetScale);
      groupRef.current.scale.lerp(_scaleVec, paused ? 1 : 0.12);
    }

    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * (0.5 + energy * 0.6 + inRef.current * 0.8);
      if (unlit) {
        const mat = ring1Ref.current.material as THREE.MeshBasicMaterial;
        mat.color.copy(pc.glow);
        mat.opacity = Math.min(1, 0.55 + energy * 0.25 + inRef.current * 0.3);
      } else {
        const mat = ring1Ref.current.material as THREE.MeshStandardMaterial;
        mat.color.copy(pc.primary);
        mat.emissive.copy(pc.glow);
        mat.emissiveIntensity = 1.2 + energy * 1.4 + inRef.current * 1.5;
      }
    }

    if (ring2Ref.current) {
      ring2Ref.current.rotation.x -= delta * (0.3 + energy * 0.4);
      if (unlit) {
        const mat = ring2Ref.current.material as THREE.MeshBasicMaterial;
        mat.color.copy(pc.glow);
        mat.opacity = Math.min(1, 0.45 + energy * 0.2 + outRef.current * 0.3);
      } else {
        const mat = ring2Ref.current.material as THREE.MeshStandardMaterial;
        mat.color.copy(pc.secondary);
        mat.emissive.copy(pc.glow);
        mat.emissiveIntensity = 0.8 + energy * 1.1 + outRef.current * 1.6;
      }
    }

    if (outerRef.current) {
      outerRef.current.rotation.y += delta * 0.05;
      const breathe = 1 + Math.sin(t * 2.2) * 0.02 * (0.4 + outRef.current);
      outerRef.current.scale.setScalar(breathe);
      const mat = outerRef.current.material as THREE.MeshBasicMaterial;
      mat.color.copy(pc.primary);
      mat.opacity = 0.18 + energy * 0.1 + outRef.current * 0.25;
    }

    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * 4) * 0.06 * (0.3 + energy);
      coreRef.current.scale.setScalar(pulse);
      const mat = coreRef.current.material as THREE.MeshBasicMaterial;
      mat.color.copy(pc.accent);
      mat.opacity = 0.85 + energy * 0.15;
    }

    // Thinking swirl: two orbiting sparks, eased in/out so it never pops.
    thinkingAlphaRef.current = approach(thinkingAlphaRef.current, thinking ? 1 : 0, 0.07, paused);
    const alpha = thinkingAlphaRef.current;
    for (let k = 0; k < 2; k++) {
      const spark = sparkRefs.current[k];
      if (!spark) continue;
      const a = t * 2.7 + k * Math.PI;
      const orbitR = 0.62;
      spark.position.set(Math.cos(a) * orbitR, Math.sin(a) * orbitR, 0);
      spark.visible = alpha > 0.02;
      const mat = spark.material as THREE.MeshBasicMaterial;
      mat.color.copy(pc.accent);
      mat.opacity = 0.9 * alpha;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Glowing core */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshBasicMaterial transparent opacity={0.9} />
      </mesh>

      {/* Counter-rotating rings — unlit materials on the light path need no
          scene lighting to read as bright (design.md D1). */}
      <mesh ref={ring1Ref} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.62, 0.045, 16, 100]} />
        {unlit ? <meshBasicMaterial transparent opacity={0.9} /> : <meshStandardMaterial />}
      </mesh>
      <mesh ref={ring2Ref} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.84, 0.02, 16, 100]} />
        {unlit ? <meshBasicMaterial transparent opacity={0.9} /> : <meshStandardMaterial />}
      </mesh>

      {/* Outer wireframe boundary sphere, breathes with Iris's voice */}
      <mesh ref={outerRef}>
        <sphereGeometry args={[1.05, 20, 20]} />
        <meshBasicMaterial wireframe transparent opacity={0.2} />
      </mesh>

      {/* Thinking swirl sparks */}
      {[0, 1].map((k) => (
        <mesh
          key={k}
          ref={(el) => {
            sparkRefs.current[k] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      ))}

      <Ripples ripplesRef={ripplesRef} />
    </group>
  );
}

export default function ReactorCore({
  state,
  inputLevelRef,
  outputLevelRef,
  thinking = false,
  wakeKey = 0,
  rippleKey = 0,
  running = true,
  rotationRef,
  scaleRef,
  highFidelity = false,
}: {
  state: ReactorState;
  /** Mic level — drives the sharp radial-bar "you are talking" signature. */
  inputLevelRef?: { current: number };
  /** Playback level — drives the smooth-wave "Iris is talking" signature. */
  outputLevelRef?: { current: number };
  /** Orbiting "thinking" swirl (the gap between your words and Iris's voice). */
  thinking?: boolean;
  /** Increment to fire the wake double-pulse. */
  wakeKey?: number;
  /** Increment to fire a single "understood you" ripple. */
  rippleKey?: number;
  /**
   * Render loop stays paused while false — no continuous frame advancement, so
   * no steady GPU cost — and resumes without state loss. A paused orb still
   * draws: it redraws on change and settles at the state it depicts.
   */
  running?: boolean;
  /** Gesture-driven rotation (radians), read every frame and lerped in smoothly. */
  rotationRef?: { current: { x: number; y: number } };
  /** Gesture-driven scale, read every frame and lerped in smoothly. */
  scaleRef?: { current: number };
  /** webgl-quality-mode: high-fidelity path (bloom, uncapped dpr) vs the light-path default. */
  highFidelity?: boolean;
}) {
  const ripplesRef = useRef<Ripple[]>([]);
  const settings = useMemo(
    () => deriveWebglSettings(highFidelity, window.devicePixelRatio),
    [highFidelity],
  );

  // Wake: two quick expanding rings + a temporary energy surge.
  useEffect(() => {
    if (!wakeKey) return;
    ripplesRef.current.push({ start: performance.now(), kind: "wake" });
    const second = window.setTimeout(() => {
      ripplesRef.current.push({ start: performance.now(), kind: "wake" });
    }, 170);
    return () => window.clearTimeout(second);
  }, [wakeKey]);

  // "Understood you": one soft ripple as your words are locked in.
  useEffect(() => {
    if (!rippleKey) return;
    ripplesRef.current.push({ start: performance.now(), kind: "heard" });
  }, [rippleKey]);

  return (
    <Canvas
      // Remount on a quality change (design.md D2): dpr/antialias/powerPreference
      // are fixed at WebGL context creation, so a running context can't adopt
      // new ones — a fresh key disposes the old context and creates a new one.
      // The refs above this Canvas (ripple queue, rotation/scale) are untouched.
      key={highFidelity ? "high-fidelity" : "light"}
      className="reactor-canvas"
      // "demand", not "never": r3f's "never" renders nothing at all until
      // advance() is called by hand, so an orb that reaches its paused
      // condition before it ever drew stays an empty canvas — the deck's CSS
      // ring and radar spinning over nothing. "demand" stops continuous
      // advancement while still drawing on mount and on change, which is what
      // orb-expressions means by paused.
      frameloop={running ? "always" : "demand"}
      camera={{ position: [0, 0, 3.2], fov: 42 }}
      gl={{ ...settings.orb.gl, alpha: true }}
      dpr={settings.orb.dpr}
    >
      {settings.orb.unlitMaterials ? null : (
        <>
          <ambientLight intensity={0.5} />
          <pointLight position={[2, 2, 3]} intensity={1.4} />
        </>
      )}
      <ArcReactorScene
        state={state}
        inputLevelRef={inputLevelRef}
        outputLevelRef={outputLevelRef}
        thinking={thinking}
        ripplesRef={ripplesRef}
        rotationRef={rotationRef}
        scaleRef={scaleRef}
        unlit={settings.orb.unlitMaterials}
        running={running}
      />
      {settings.orb.bloom ? (
        <EffectComposer>
          <Bloom luminanceThreshold={0.15} mipmapBlur intensity={1.4} radius={0.4} />
        </EffectComposer>
      ) : null}
    </Canvas>
  );
}
