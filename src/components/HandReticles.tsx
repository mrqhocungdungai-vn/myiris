import { useEffect, useRef } from "react";
import type { HandState } from "../hooks/useHandControl";
import { RETICLE_SLOTS, reticleClassName, reticleSlots } from "../lib/hand-reticle";

// Floating gesture cursors, one per tracked hand, rendered above everything.
//
// A FIXED pair of nodes that never mount or unmount with a hand — the pair is
// the tracker's own `numHands: 2` ceiling. Each frame decides, per slot,
// whether it shows a hand and which: position, pose classes and visibility are
// all written directly to the node.
//
// This is deliberately NOT "React decides which reticles exist, a rAF loop
// moves them". That split is what both reported defects grew in: a cursor
// mounted off semantic state and moved off a per-frame ref answers to two
// clocks, so its existence outlives, and can multiply beyond, the data that
// justifies it — one report was a cursor left standing after the hand was
// gone, the other was cursors strewn across the screen as a hand was waved,
// which no reading of the old component fully explains. Rather than keep
// guessing at which render did not happen, the shape that admits the question
// is gone: with the node count fixed, nothing can be created and nothing can
// be left behind, and a hand that goes away is hidden by the very next frame —
// including when the React tree above has stopped re-rendering entirely.
//
// What this cannot fix is a cursor drawn by something that is not this
// component, so the loop counts the reticles in the document and says so.
export default function HandReticles({
  handRef,
  dwelling,
}: {
  /** Per-frame hand data (useHandControl's stateRef) — the only source this reads. */
  handRef: { current: HandState };
  dwelling: boolean;
}) {
  const nodeRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Read inside the loop rather than closed over, so a prop change does not
  // have to tear down and re-create the loop to be seen.
  const dwellingRef = useRef(dwelling);
  dwellingRef.current = dwelling;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const slots = reticleSlots(handRef.current);
      for (let index = 0; index < RETICLE_SLOTS; index += 1) {
        const node = nodeRefs.current[index];
        if (!node) continue;
        const hand = slots[index]?.hand ?? null;
        // Hidden, not removed: `visibility` keeps the node's compositing layer
        // alive, so showing a hand again is a style write rather than a mount.
        node.style.visibility = hand ? "visible" : "hidden";
        node.className = reticleClassName(index, hand, dwellingRef.current);
        if (!hand) continue;
        // translate3d, not translate: the cursor sits over a transparent
        // window in HUD mode, and a 3D transform keeps it on its own GPU layer
        // instead of repainting the region under it.
        node.style.transform = `translate3d(${hand.point.x}px, ${hand.point.y}px, 0)`;
      }
      auditStrayNodes();
      raf = requestAnimationFrame(loop);
    };

    // A count, once a second, of the `.hand-reticle` nodes in the document.
    //
    // The pair above cannot multiply, so anything beyond it is a cursor this
    // component does not own — the signature of a second React tree rendering
    // into the same document (a dev root created twice, a tree left mounted
    // after a reload). That is not something this component can fix, and
    // silently competing with it would be worse than saying so: the report is
    // one line in the renderer console, which `window.mjs` forwards into
    // `~/.myiris/logs/iris.log`, so the evidence survives the session.
    let lastAudit = 0;
    let reportedStrays = 0;
    function auditStrayNodes() {
      const now = performance.now();
      if (now - lastAudit < 1000) return;
      lastAudit = now;
      const total = document.querySelectorAll(".hand-reticle").length;
      if (total <= RETICLE_SLOTS || total === reportedStrays) return;
      reportedStrays = total;
      console.warn(
        `[hand-reticles] ${total} reticle nodes in the document, but this component owns ${RETICLE_SLOTS} — ` +
          "the extras belong to another React tree rendering into the same page.",
      );
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handRef]);

  return (
    <>
      {Array.from({ length: RETICLE_SLOTS }, (_, index) => (
        <div
          key={index}
          ref={(el) => {
            nodeRefs.current[index] = el;
          }}
          className={reticleClassName(index, null, false)}
          // Hidden until a frame says otherwise, so an empty slot never flashes
          // at the origin on the first paint.
          style={{ visibility: "hidden" }}
        >
          <span className="hand-ring" />
          <span className="hand-dot" />
        </div>
      ))}
    </>
  );
}
