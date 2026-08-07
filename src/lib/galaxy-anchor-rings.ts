import * as THREE from "three";

// Canvas mechanics for the galaxy's anchor marks (galaxy-note-reachable-by-hand
// design.md D10) — the faint ring on the node a grab WOULD anchor to, and the
// stronger ring on the node the camera is actually turning around.
//
// Same shape and the same untested-for-a-stated-reason as
// `galaxy-label-sprites.ts`: it needs a 2D canvas context, and `src/**/*.test.ts`
// runs in vitest's `node` environment (vitest.config.mjs) where `document` does
// not exist. Its correctness is covered by the manual pass.
//
// Sprites rather than `RingGeometry` meshes, deliberately: a ring drawn as
// geometry has to be re-oriented toward the camera every frame, which would put
// the camera into `apply()`'s signature and add a `lookAt` per mark. A sprite
// faces the camera by construction, so `apply` stays a position write.
//
// `apply` mutates in place and allocates nothing: the gesture loop already
// allocates per frame (a `Vector3` per camera write, plus a
// `getBoundingClientRect()`), and marks that ran every frame must not add to
// that.

const CANVAS_SIZE = 128;

// Both marks are ACHROMATIC on purpose (design.md 4.2 / the spec's "not
// confusable with the highlight or the focus"). Every other galaxy treatment is
// a hue — the six TAG_COLORS, the ghost grey-blue, DWELL_HIGHLIGHT_COLOR's
// yellow, FOCUS_HIGHLIGHT_COLOR's green — so picking a seventh hue would put
// these marks into the same visual channel as "which tag is this" and "is this
// focused". A neutral outline at two weights sits in a different channel
// entirely: the marks differ from every node treatment in SHAPE (a ring around
// the dot, not the dot's colour) and from each other in WEIGHT.
const CANDIDATE_COLOR = "rgba(214, 228, 255, 0.42)";
const CANDIDATE_LINE_PX = 5;
const ANCHOR_COLOR = "rgba(255, 255, 255, 0.92)";
const ANCHOR_LINE_PX = 9;

// World-space diameters. A node's own sphere is ~4 units (three-forcegraph's
// default `nodeRelSize`), so both rings stand clear of the dot they mark, and
// the anchor's is the wider of the two.
const CANDIDATE_WORLD_SIZE = 16;
const ANCHOR_WORLD_SIZE = 24;

export type Vec3Like = { x: number; y: number; z: number };

function createRingSprite(color: string, lineWidthPx: number, worldSize: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.beginPath();
  ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - lineWidthPx, 0, Math.PI * 2);
  ctx.lineWidth = lineWidthPx;
  ctx.strokeStyle = color;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  // Same non-power-of-two caution the label pool documents: default mipmapping
  // on a canvas texture either warns or samples wrong.
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    // A mark must read even when the node it marks is behind other geometry —
    // it answers "what would I grab", which is useless if the dense core hides
    // it. `depthTest: false` is why, and `depthWrite: false` keeps it from
    // punching a hole in anything drawn after.
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldSize, worldSize, 1);
  sprite.visible = false;
  // Drawn after the graph's own objects, so the ring is not swallowed by the
  // node sphere it surrounds.
  sprite.renderOrder = 2;
  return sprite;
}

export type AnchorRings = {
  group: THREE.Group;
  /** Positions and shows each ring, hiding either whose position is null. Mutates in place — allocates nothing. */
  apply(candidatePos: Vec3Like | null, anchorPos: Vec3Like | null): void;
  /** Disposes both textures/materials and removes `group` from its parent. */
  dispose(): void;
};

/**
 * The candidate/anchor ring pair, in one `THREE.Group` the caller adds to the
 * graph's scene (galaxy-note-reachable-by-hand design.md D10).
 */
export function createRingPair(): AnchorRings {
  const group = new THREE.Group();
  const candidate = createRingSprite(CANDIDATE_COLOR, CANDIDATE_LINE_PX, CANDIDATE_WORLD_SIZE);
  const anchor = createRingSprite(ANCHOR_COLOR, ANCHOR_LINE_PX, ANCHOR_WORLD_SIZE);
  group.add(candidate);
  group.add(anchor);

  function apply(candidatePos: Vec3Like | null, anchorPos: Vec3Like | null) {
    if (candidatePos) {
      candidate.position.set(candidatePos.x, candidatePos.y, candidatePos.z);
      candidate.visible = true;
    } else {
      candidate.visible = false;
    }
    if (anchorPos) {
      anchor.position.set(anchorPos.x, anchorPos.y, anchorPos.z);
      anchor.visible = true;
    } else {
      anchor.visible = false;
    }
  }

  function dispose() {
    for (const sprite of [candidate, anchor]) {
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    group.parent?.remove(group);
  }

  return { group, apply, dispose };
}
