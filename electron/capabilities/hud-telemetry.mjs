// The HUD-telemetry capability (eye-tracking-hud): the lifecycle and the
// renderer-facing surface for the host measurements the eye readout panel
// displays. system-telemetry.mjs does the measuring; this owns when it runs and
// where its samples go (hud-readout-shows-real-telemetry D1/D2).
//
// The first capability contributing neither a tool declaration nor a prompt
// fragment, and that is deliberate. The capability contract states every field
// is optional, and this tier is organized by SPEC capability — canvas.mjs serves
// hud-drawing-canvas, second-brain.mjs serves personal-knowledge-notes. This
// module serves exactly one, eye-tracking-hud, end to end, and is consumed by no
// other main-process module. Registering here rather than as a core module also
// means ipc.mjs, ipc.test.mjs, main.mjs and wiring.mjs stay untouched: capability
// channels register by iteration and capability teardown is already sequenced
// centrally.
//
// Nothing downstream may read these numbers. They reach the renderer's two
// overlay components and stop — no verb, no prompt, no run, no disk. The spec
// requires it, and it is what keeps the readout's clipping acceptable.
import { createSystemTelemetry } from "../system-telemetry.mjs";

/**
 * @param {{
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   getMainWindow: () => any,
 *   createTelemetry?: typeof createSystemTelemetry,
 * }} deps
 */
export function createHudTelemetryCapability({ emitToRenderer, getMainWindow, createTelemetry = createSystemTelemetry }) {
  const telemetry = createTelemetry({
    onSample: (sample) => {
      // The renderer can be gone without its React cleanup ever having run — a
      // reload, a crashed frame. Nothing would tell the sampler otherwise, so
      // it self-stops rather than measuring for nobody until the app quits.
      const win = getMainWindow();
      if (!win || win.isDestroyed()) {
        telemetry.stop();
        return;
      }
      emitToRenderer("hud-telemetry:sample", sample);
    },
  });

  // Two channels rather than one carrying a boolean, matching the closest
  // precedent (secondbrain:activate/deactivate) — the same renderer-gated
  // watcher lifecycle, for the same recorded reason: an always-on sampler
  // spawning subprocesses for a view that is off by default is the wrong
  // default. Both underlying calls are idempotent, so camera toggling and
  // deck/HUD churn cost nothing.
  //
  // The gate is the CAMERA, not face presence (D6): presence flickers frame to
  // frame by design, so gating on it would thrash start/stop and pay the
  // priming interval on every re-acquire.
  /** @type {Array<{ channel: string, kind: "handle"|"on", fn: Function }>} */
  const ipcHandlers = [
    { channel: "hud-telemetry:activate", kind: "on", fn: () => telemetry.start() },
    { channel: "hud-telemetry:deactivate", kind: "on", fn: () => telemetry.stop() },
  ];

  function teardown() {
    // Nothing to flush — the readout keeps no history worth surviving a quit,
    // and deliberately writes nothing to disk. Stopping is the whole contract.
    telemetry.stop();
  }

  return {
    toolDeclarations: [],
    ipcHandlers,
    teardown,
    // Exposed for the capability's own tests; no other module calls these.
    isSampling: () => telemetry.isRunning(),
  };
}
