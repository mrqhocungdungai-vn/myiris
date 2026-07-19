import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import "../styles/holo.css";

const NODE_COUNT = 46;
const CONNECT_DISTANCE = 2.6;

function readToken(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function buildNetwork() {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    points.push(
      new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 5.5,
        (Math.random() - 0.5) * 4 - 1.5,
      ),
    );
  }

  const nodePositions = new Float32Array(points.length * 3);
  points.forEach((p, i) => p.toArray(nodePositions, i * 3));

  const edges: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[i].distanceTo(points[j]) < CONNECT_DISTANCE) {
        edges.push(points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z);
      }
    }
  }

  return { nodePositions, edgePositions: new Float32Array(edges) };
}

function Network() {
  const groupRef = useRef<THREE.Group>(null);
  const { nodePositions, edgePositions } = useMemo(buildNetwork, []);
  const { cyan, violet } = useMemo(
    () => ({
      cyan: new THREE.Color(readToken("--cyan", "#22d3ee")),
      violet: new THREE.Color(readToken("--violet", "#8b5cf6")),
    }),
    [],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.y += delta * 0.025;
    group.rotation.x += delta * 0.008;
  });

  return (
    <group ref={groupRef}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={cyan} transparent opacity={0.16} />
      </lineSegments>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={violet} size={0.06} sizeAttenuation transparent opacity={0.85} />
      </points>
    </group>
  );
}

export default function HoloBackdrop({ running = true }: { running?: boolean }) {
  return (
    <div className="holo-backdrop" aria-hidden="true">
      <Canvas
        frameloop={running ? "always" : "never"}
        camera={{ position: [0, 0, 7], fov: 42 }}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      >
        <Network />
        <EffectComposer>
          <Bloom luminanceThreshold={0.05} mipmapBlur intensity={0.9} radius={0.55} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
