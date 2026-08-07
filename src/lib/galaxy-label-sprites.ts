import * as THREE from "three";
import type { GalaxyNavNode } from "./galaxy-nav";

// Canvas mechanics for the galaxy's proximity titles (add-galaxy-node-labels
// design.md D1/D2). Deliberately NOT unit-tested, and for a stated reason
// rather than an omission: it needs a 2D canvas context, and
// `src/**/*.test.ts` runs in vitest's `node` environment (vitest.config.mjs),
// where `document` does not exist — the same reason `addStarfield`
// (VaultGalaxy.tsx) has no test. Its correctness is covered by the manual
// pass in tasks.md section 5.
//
// `nodeThreeObject` (three-forcegraph's own per-node hook) is the wrong tool
// here — it fires for every node the graph digests, so a 3000-note vault
// would allocate 3000 canvases/textures up front for at most a couple dozen
// ever visible (design.md D2). Instead this is a fixed pool of `budget`
// sprites, created once and reassigned on every `apply()` call — the number
// of textures is a constant of the code, not a function of the vault.

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 96;
const FONT_PX = 48;
const PADDING_PX = 12;
// Soft blue-white rather than pure white: UnrealBloomPass's threshold (0.15,
// VaultGalaxy.tsx addBloom) blooms bright text into an illegible smear on the
// high-fidelity path (design.md Risks).
const REAL_TITLE_COLOR = "#cfe0ff";
// Matches colorForNode's ghost gray (VaultGalaxy.tsx) — named but not
// openable, so the title must not read as brighter/more important than the
// node it labels (design.md D8).
const GHOST_TITLE_COLOR = "rgba(200, 210, 230, 0.75)";

type Slot = {
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  sprite: THREE.Sprite;
  assignedId: string | null;
};

function createSlot(): Slot {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  const texture = new THREE.CanvasTexture(canvas);
  // A non-power-of-two canvas with default mipmapping either warns or
  // samples wrong (design.md D1) — both load-bearing.
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false, // occluded by geometry in front, never punches a hole in it (design.md D1)
    depthTest: true,
    sizeAttenuation: true, // a title grows as the camera closes on it (design.md D6) — THREE.SpriteMaterial's own default, named here deliberately
  });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  // Above the anchor marks (`galaxy-anchor-rings.ts` uses renderOrder 2), which
  // are drawn with `depthTest: false` so they read through the dense core. That
  // makes them paint over whatever was drawn before them — including the title
  // of the very note they are marking, whose band they necessarily cross: the
  // label sits ~3.5-8.5 world units above the dot and any ring wide enough to
  // stand clear of the dot reaches it. A mark exists to say "this is the note",
  // so a mark that hides the note's name defeats itself; the name wins.
  sprite.renderOrder = 3;
  return { ctx, texture, material, sprite, assignedId: null };
}

// Draws `title` into `slot`'s canvas — measured elision (shrinking prefixes +
// "…" until it fits, spec: "elided rather than drawn as a banner"), then
// crops the texture to the measured region via repeat/offset and scales the
// sprite to the measured aspect, so a short and a long title draw at the same
// text HEIGHT rather than a naive "centre it in a fixed quad" getting that
// wrong (design.md D2).
function paintSlot(slot: Slot, title: string, color: string, worldHeight: number) {
  const { ctx } = slot;
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${FONT_PX}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;

  const maxTextWidth = canvas.width - PADDING_PX * 2;
  let text = title;
  if (ctx.measureText(text).width > maxTextWidth) {
    let end = text.length;
    while (end > 0 && ctx.measureText(text.slice(0, end) + "…").width > maxTextWidth) end--;
    text = text.slice(0, end) + "…";
  }
  const textWidth = Math.max(1, ctx.measureText(text).width);
  ctx.fillText(text, PADDING_PX, canvas.height / 2);

  const regionWidth = Math.min(canvas.width, textWidth + PADDING_PX * 2);
  slot.texture.repeat.set(regionWidth / canvas.width, 1);
  slot.texture.offset.set(0, 0);
  slot.texture.needsUpdate = true;

  const aspect = regionWidth / canvas.height;
  slot.sprite.scale.set(worldHeight * aspect, worldHeight, 1);
}

export type LabelPool = {
  group: THREE.Group;
  /** Assigns `selection[i]` to slot `i`, nearest first — repaints only a slot whose id changed, positions every slot at its node's live x/y/z, and hides the tail when `selection` is shorter than the pool. */
  apply(selection: GalaxyNavNode[]): void;
  /** Disposes every texture/material and removes `group` from its parent. */
  dispose(): void;
};

/**
 * A fixed pool of `budget` label sprites in one `THREE.Group` (design.md D2).
 * `yOffset` sits a title above its node instead of z-fighting with the sphere
 * geometry; `worldHeight` is the world-space text height every title shares
 * regardless of how long it is. Both are tuning constants owned by
 * `VaultGalaxy.tsx` (design.md D9) and threaded through here rather than
 * duplicated.
 */
export function createLabelPool(budget: number, yOffset: number, worldHeight: number): LabelPool {
  const group = new THREE.Group();
  const slots: Slot[] = [];
  for (let i = 0; i < budget; i++) {
    const slot = createSlot();
    slots.push(slot);
    group.add(slot.sprite);
  }

  function apply(selection: GalaxyNavNode[]) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const node = selection[i];
      if (!node || node.x === undefined) {
        slot.sprite.visible = false;
        slot.assignedId = null;
        continue;
      }
      if (slot.assignedId !== node.id) {
        paintSlot(slot, node.title, node.ghost ? GHOST_TITLE_COLOR : REAL_TITLE_COLOR, worldHeight);
        slot.assignedId = node.id;
      }
      slot.sprite.position.set(node.x, (node.y ?? 0) + yOffset, node.z ?? 0);
      slot.sprite.visible = true;
    }
  }

  function dispose() {
    for (const slot of slots) {
      slot.texture.dispose();
      slot.material.dispose();
    }
    group.parent?.remove(group);
  }

  return { group, apply, dispose };
}
