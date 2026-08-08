import { useEffect, useRef } from "react";

// eye-tracking-hud: the renderer's end of the host-telemetry channel. Main
// measures; this subscribes while the camera is on and parks the latest sample
// in a ref (hud-readout-shows-real-telemetry D7).
//
// Deliberately publishes NO React state. useEyeTracking calls setState on
// presence transitions because the tree branches on presence; nothing branches
// on telemetry, so a sample arriving re-renders nothing at all. The overlays
// read `sampleRef` inside the rAF loops they already run — the same seam
// `stateRef` gives them for eye position.

// `TelemetrySample` is the global declared alongside IrisApi in vite-env.d.ts —
// the same convention SecondBrainFocusState and every other IPC payload type
// follows, so the shape has exactly one definition and it is the one the preload
// surface is typed against.

/**
 * `at: 0` reads as infinitely stale, so a panel mounted before the first sample
 * arrives shows absence rather than a plausible-looking set of zeroes.
 */
export const EMPTY_SAMPLE: TelemetrySample = { at: 0, cpu: null, gpu: null, netRx: null, netTx: null };

/**
 * Call ONCE, at App level, gated on the same boolean gesture control uses.
 *
 * Not inside EyeReadout: it mounts in both camera surfaces, so it would open
 * two subscriptions and send two activate/deactivate pairs, and it unmounts on
 * every face loss, which would thrash the sampler on every blink. The gate is
 * the camera, not face presence, for that second reason (D6).
 */
export function useSystemTelemetry(enabled: boolean): { sampleRef: { current: TelemetrySample } } {
  const sampleRef = useRef<TelemetrySample>(EMPTY_SAMPLE);

  useEffect(() => {
    if (!enabled || typeof window.iris === "undefined") return;
    // Clear on every activation: main resets its own baselines on start, so a
    // sample held from before the camera was switched off would sit in the
    // panel as current until the first fresh one lands.
    sampleRef.current = EMPTY_SAMPLE;
    const unsubscribe = window.iris.onSystemTelemetrySample((sample) => {
      sampleRef.current = sample;
    });
    window.iris.startSystemTelemetry();
    return () => {
      unsubscribe();
      window.iris.stopSystemTelemetry();
      sampleRef.current = EMPTY_SAMPLE;
    };
  }, [enabled]);

  return { sampleRef };
}
