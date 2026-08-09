import { describe, it, expect } from "vitest";
import {
  HUD_INTERACTIVE_SELECTOR,
  isHudInteractiveTarget,
  resolveHudInteractive,
} from "./hud-interactivity";

describe("hud-interactivity: who owns the mouse", () => {
  it("hands the window the pointer for as long as an exclusive fullscreen layer is open", () => {
    // The drawing surface and the galaxy both cover the display, so there is
    // no position at which the answer differs.
    expect(resolveHudInteractive({ exclusiveLayerActive: true, overInteractiveTarget: false })).toBe(true);
    expect(resolveHudInteractive({ exclusiveLayerActive: true, overInteractiveTarget: true })).toBe(true);
  });

  it("leaves the desktop clickable when no layer is open and the pointer is over glass", () => {
    // The regression this file exists for: a window-wide `true` held while the
    // user is not interacting with the HUD swallows every click on the machine,
    // because this window is display-sized and above the menu bar.
    expect(resolveHudInteractive({ exclusiveLayerActive: false, overInteractiveTarget: false })).toBe(false);
  });

  it("takes the pointer for a HUD island under it", () => {
    expect(resolveHudInteractive({ exclusiveLayerActive: false, overInteractiveTarget: true })).toBe(true);
  });
});

describe("hud-interactivity: what counts as an interactive target", () => {
  // The suite runs on `environment: "node"` (vitest.config.mjs), so there is
  // no document. `isHudInteractiveTarget` uses exactly one DOM call —
  // `closest` — which is all that has to be stood in for; a fake that answers
  // it states the contract more plainly than a jsdom tree would anyway.
  function el(classes: string[], ancestorClasses: string[] = classes): Element {
    return {
      closest: (selector: string) =>
        selector
          .split(",")
          .map((part) => part.trim())
          .some((part) => ancestorClasses.includes(part))
          ? ({ className: classes.join(" ") } as unknown as Element)
          : null,
    } as unknown as Element;
  }

  it("matches a HUD island and anything inside one", () => {
    expect(isHudInteractiveTarget(el([".hud-hit"]))).toBe(true);
    // A button whose ANCESTOR is the island: `closest` is what makes the
    // difference, which is why the adapter uses it rather than classList.
    expect(isHudInteractiveTarget(el([], [".hud-hit"]))).toBe(true);
  });

  it("matches excalidraw UI portalled out of the surface into document.body", () => {
    // These are the dialogs that rendered and could not be clicked: they are
    // not inside `.hud-drawing-panel`, so only naming them here saves them.
    expect(isHudInteractiveTarget(el([".excalidraw-modal-container"]))).toBe(true);
    expect(isHudInteractiveTarget(el([".excalidraw-eye-dropper-backdrop"]))).toBe(true);
  });

  it("does not match plain glass, and tolerates no element at all", () => {
    expect(isHudInteractiveTarget(el([".something-else"]))).toBe(false);
    expect(isHudInteractiveTarget(null)).toBe(false);
    // An element with no `closest` at all (jsdom-free callers, odd targets)
    // must not throw — the adapter is optional-chained for this.
    expect(isHudInteractiveTarget({} as Element)).toBe(false);
  });

  it("keeps the selector in step with the stylesheet's pointer-events list", () => {
    // If a class is added to one and not the other, elementFromPoint and CSS
    // disagree and the symptom is an unclickable control — cheap to assert.
    for (const cls of [".hud-hit", ".excalidraw-modal-container", ".excalidraw-eye-dropper-backdrop"]) {
      expect(HUD_INTERACTIVE_SELECTOR).toContain(cls);
    }
  });
});
