import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_SYSTEM_AUDIO_GAIN,
  MIN_MIC_GAIN,
  isCaptureSilent,
  listenOnlyControlTitle,
  resolveInputMix,
  watchCaptureLiveness,
} from "./system-audio";

// listen-mode-hears-system-audio 4.6. The mix decision is pure so the headroom
// property is provable without a Web Audio graph — vitest runs `environment:
// "node"`, so the graph itself is only reachable by manual acceptance.
describe("resolveInputMix", () => {
  it("leaves a microphone-only session exactly as it was — unity, one source", () => {
    expect(resolveInputMix({ systemAudioActive: false, systemAudioGain: 0.7 })).toEqual({
      micGain: 1,
      systemGain: 0,
      sources: ["microphone"],
      state: "microphone",
    });
  });

  it("gives the mix headroom by construction rather than relying on the worklet's clamp", () => {
    // Clamping IS clipping: it adds harmonic distortion, which degrades exactly
    // the transcription this mode exists to produce. So the nominal full-scale
    // sum stays at 1.0 and the clamp is left as a last resort.
    for (const systemAudioGain of [0, 0.3, 0.5, 0.7]) {
      const mix = resolveInputMix({ systemAudioActive: true, systemAudioGain });
      expect(mix.micGain + mix.systemGain).toBeLessThanOrEqual(1);
    }
  });

  it("never lets the microphone be silenced, however loud system audio is configured", () => {
    // The mode exists so Iris hears the meeting AS WELL AS the room.
    const mix = resolveInputMix({ systemAudioActive: true, systemAudioGain: 1 });
    expect(mix.micGain).toBe(MIN_MIC_GAIN);
    expect(mix.systemGain).toBe(1);
  });

  it("clamps an out-of-range gain and falls back on a malformed one", () => {
    expect(resolveInputMix({ systemAudioActive: true, systemAudioGain: 4 }).systemGain).toBe(1);
    expect(resolveInputMix({ systemAudioActive: true, systemAudioGain: -2 }).systemGain).toBe(0);
    expect(resolveInputMix({ systemAudioActive: true, systemAudioGain: NaN }).systemGain).toBe(
      DEFAULT_SYSTEM_AUDIO_GAIN,
    );
  });

  it("reports both sources once system audio is live", () => {
    expect(resolveInputMix({ systemAudioActive: true, systemAudioGain: 0.7 }).sources).toEqual([
      "microphone",
      "system",
    ]);
  });
});

// listen-mode-hears-system-audio 5.4/5.5. The failure that actually occurs is
// not an error: getDisplayMedia resolves, the track reports `live`, and every
// sample is exactly zero. A check that only asks whether acquisition succeeded
// reports a working capture while Iris hears nothing for a whole meeting.
describe("isCaptureSilent", () => {
  it("calls an all-zero window a failed capture", () => {
    expect(isCaptureSilent(new Float32Array(2048))).toBe(true);
  });

  it("does not call a normal signal silent — not even one that is mostly zero", () => {
    const samples = new Float32Array(2048);
    samples[1024] = 0.0001;
    expect(isCaptureSilent(samples)).toBe(false);
  });

  it("treats an empty window as no evidence rather than as silence", () => {
    expect(isCaptureSilent(new Float32Array(0))).toBe(false);
  });
});

describe("watchCaptureLiveness", () => {
  function fakeAnalyser(fill: number): AnalyserNode {
    return {
      fftSize: 8,
      getFloatTimeDomainData(buffer: Float32Array) {
        buffer.fill(fill);
      },
    } as unknown as AnalyserNode;
  }

  /** Drives the watch by hand — no timers, so the tick count is exact. */
  function run(analyser: AnalyserNode, ticks: number) {
    const onSilent = vi.fn();
    const onLive = vi.fn();
    let tick: (() => void) | null = null;
    let cleared = false;
    watchCaptureLiveness({
      analyser,
      onSilent,
      onLive,
      ticks,
      setInterval: ((fn: () => void) => {
        tick = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof globalThis.setInterval,
      clearInterval: (() => {
        cleared = true;
      }) as typeof globalThis.clearInterval,
    });
    for (let i = 0; i < ticks; i++) tick?.();
    return { onSilent, onLive, cleared: () => cleared };
  }

  it("reports a failure only after the whole window reads bit-exact zero", () => {
    const { onSilent, onLive } = run(fakeAnalyser(0), 3);
    expect(onSilent).toHaveBeenCalledTimes(1);
    expect(onLive).not.toHaveBeenCalled();
  });

  it("stops itself on the first real signal, so a quiet start is not called broken", () => {
    const { onSilent, cleared } = run(fakeAnalyser(0.2), 3);
    expect(onSilent).not.toHaveBeenCalled();
    expect(cleared()).toBe(true);
  });

  // Without this the watch cancels itself on real signal and emits nothing, so
  // "Iris heard the machine" is not observable at all — which is the whole
  // question the Permissions step's self-test asks (D6).
  it("emits once on the first real signal, so 'heard' is observable", () => {
    const { onLive } = run(fakeAnalyser(0.2), 3);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  // The mode passes no onLive and must behave exactly as before.
  it("is optional — the mode's own live path passes none", () => {
    const analyser = fakeAnalyser(0.2);
    let tick: (() => void) | null = null;
    expect(() => {
      watchCaptureLiveness({
        analyser,
        onSilent: vi.fn(),
        ticks: 3,
        setInterval: ((fn: () => void) => {
          tick = fn;
          return 1 as unknown as ReturnType<typeof setInterval>;
        }) as typeof globalThis.setInterval,
        clearInterval: (() => {}) as typeof globalThis.clearInterval,
      });
      tick?.();
    }).not.toThrow();
  });
});

describe("listenOnlyControlTitle", () => {
  it("names the degraded state on the control, which is the only place the user looks", () => {
    expect(listenOnlyControlTitle(true, "degraded")).toMatch(/NOT hearing/);
    expect(listenOnlyControlTitle(true, "live")).toMatch(/hearing your machine/);
    expect(listenOnlyControlTitle(false, "off")).toMatch(/goes silent/);
  });
});
