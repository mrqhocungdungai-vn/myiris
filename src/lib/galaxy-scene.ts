import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { GalaxyNode, GalaxyLink } from "./galaxy-types";

// The galaxy scene's decoration — the starfield behind the graph and the bloom
// pass over it. Both are one-shot setup called once when the view mounts, and
// neither reads any component state, so they sat in `VaultGalaxy.tsx` only
// because that is where the scene is created.

// Deep-space backdrop mechanism (design.md D4, spike-resolved 3.2b): the
// composer's UnrealBloomPass forces full-screen opacity, so the backdrop is
// painted *inside* the graph scene (opaque `backgroundColor` + a starfield
// of points) rather than as a CSS layer behind a transparent canvas.
export function addStarfield(scene: THREE.Scene) {
  const count = 1200;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = 400 + Math.random() * 1600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x9fb4ff, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.7 });
  scene.add(new THREE.Points(geometry, material));
}

export async function addBloom(fg: ForceGraph3DInstance<GalaxyNode, GalaxyLink>) {
  // fg.postProcessingComposer() already owns the EffectComposer 3d-force-graph
  // created internally (see three-render-objects) — just add a pass to it.
  const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
  const composer = fg.postProcessingComposer();
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.1, 0.6, 0.15));
}
