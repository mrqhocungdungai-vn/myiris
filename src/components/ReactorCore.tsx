import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Group, Mesh } from "three";
import "../styles/reactor.css";

type ReactorState = "idle" | "online" | "listening" | "speaking" | "working";

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
  working: { primary: "120, 180, 120", secondary: "40, 200, 170", accent: "252, 255, 230", glow: "130, 195, 150" },
};

function rgbToColor(rgb: string) {
  const [r, g, b] = rgb.split(",").map((n) => parseFloat(n) / 255);
  return new THREE.Color(r, g, b);
}

function targetEnergy(s: ReactorState) {
  if (s === "speaking") return 1;
  if (s === "working") return 0.88;
  if (s === "listening") return 0.72;
  if (s === "online") return 0.45;
  return 0.18;
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
      material.color = rgbToColor(ripple.kind === "wake" ? PALETTES.online.secondary : PALETTES.online.accent);
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
}: {
  state: ReactorState;
  inputLevelRef?: { current: number };
  outputLevelRef?: { current: number };
  thinking: boolean;
  ripplesRef: { current: Ripple[] };
  rotationRef?: { current: { x: number; y: number } };
  scaleRef?: { current: number };
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

  useFrame((threeState, delta) => {
    const palette = PALETTES[state];
    energyRef.current += (targetEnergy(state) - energyRef.current) * 0.06;
    const inTarget = inputLevelRef ? Math.max(0, Math.min(1, inputLevelRef.current)) : 0;
    const outTarget = outputLevelRef ? Math.max(0, Math.min(1, outputLevelRef.current)) : 0;
    inRef.current += (inTarget - inRef.current) * 0.35;
    outRef.current += (outTarget - outRef.current) * 0.35;
    const energy = energyRef.current;
    const t = threeState.clock.elapsedTime;

    if (groupRef.current) {
      const targetX = rotationRef?.current.x ?? 0;
      const targetY = rotationRef?.current.y ?? 0;
      groupRef.current.rotation.x += (targetX - groupRef.current.rotation.x) * 0.1;
      groupRef.current.rotation.y += (targetY - groupRef.current.rotation.y) * 0.1 + delta * 0.02;
      const targetScale = scaleRef?.current ?? 1;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
    }

    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * (0.5 + energy * 0.6 + inRef.current * 0.8);
      const mat = ring1Ref.current.material as THREE.MeshStandardMaterial;
      mat.color = rgbToColor(palette.primary);
      mat.emissive = rgbToColor(palette.glow);
      mat.emissiveIntensity = 1.2 + energy * 1.4 + inRef.current * 1.5;
    }

    if (ring2Ref.current) {
      ring2Ref.current.rotation.x -= delta * (0.3 + energy * 0.4);
      const mat = ring2Ref.current.material as THREE.MeshStandardMaterial;
      mat.color = rgbToColor(palette.secondary);
      mat.emissive = rgbToColor(palette.glow);
      mat.emissiveIntensity = 0.8 + energy * 1.1 + outRef.current * 1.6;
    }

    if (outerRef.current) {
      outerRef.current.rotation.y += delta * 0.05;
      const breathe = 1 + Math.sin(t * 2.2) * 0.02 * (0.4 + outRef.current);
      outerRef.current.scale.setScalar(breathe);
      const mat = outerRef.current.material as THREE.MeshBasicMaterial;
      mat.color = rgbToColor(palette.primary);
      mat.opacity = 0.18 + energy * 0.1 + outRef.current * 0.25;
    }

    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * 4) * 0.06 * (0.3 + energy);
      coreRef.current.scale.setScalar(pulse);
      const mat = coreRef.current.material as THREE.MeshBasicMaterial;
      mat.color = rgbToColor(palette.accent);
      mat.opacity = 0.85 + energy * 0.15;
    }

    // Thinking swirl: two orbiting sparks, eased in/out so it never pops.
    thinkingAlphaRef.current += ((thinking ? 1 : 0) - thinkingAlphaRef.current) * 0.07;
    const alpha = thinkingAlphaRef.current;
    for (let k = 0; k < 2; k++) {
      const spark = sparkRefs.current[k];
      if (!spark) continue;
      const a = t * 2.7 + k * Math.PI;
      const orbitR = 0.62;
      spark.position.set(Math.cos(a) * orbitR, Math.sin(a) * orbitR, 0);
      spark.visible = alpha > 0.02;
      const mat = spark.material as THREE.MeshBasicMaterial;
      mat.color = rgbToColor(palette.accent);
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

      {/* Counter-rotating rings */}
      <mesh ref={ring1Ref} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.62, 0.045, 16, 100]} />
        <meshStandardMaterial />
      </mesh>
      <mesh ref={ring2Ref} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.84, 0.02, 16, 100]} />
        <meshStandardMaterial />
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
  /** Render loop stays paused (0 GPU) while false; resumes without state loss. */
  running?: boolean;
  /** Gesture-driven rotation (radians), read every frame and lerped in smoothly. */
  rotationRef?: { current: { x: number; y: number } };
  /** Gesture-driven scale, read every frame and lerped in smoothly. */
  scaleRef?: { current: number };
}) {
  const ripplesRef = useRef<Ripple[]>([]);

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
      className="reactor-canvas"
      frameloop={running ? "always" : "never"}
      camera={{ position: [0, 0, 3.2], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[2, 2, 3]} intensity={1.4} />
      <ArcReactorScene
        state={state}
        inputLevelRef={inputLevelRef}
        outputLevelRef={outputLevelRef}
        thinking={thinking}
        ripplesRef={ripplesRef}
        rotationRef={rotationRef}
        scaleRef={scaleRef}
      />
      <EffectComposer>
        <Bloom luminanceThreshold={0.15} mipmapBlur intensity={1.4} radius={0.4} />
      </EffectComposer>
    </Canvas>
  );
}
