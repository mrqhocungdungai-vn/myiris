import { describe, it, expect, vi } from "vitest";
import { createHudTelemetryCapability } from "./hud-telemetry.mjs";

/**
 * A stand-in sampler with the same surface as the real one, so the capability's
 * lifecycle can be asserted without any subprocess or timer at all. `emit` fires
 * whatever the capability handed in as onSample.
 */
function fakeTelemetry() {
  /** @type {{ running: boolean, starts: number, stops: number, onSample: any }} */
  const state = { running: false, starts: 0, stops: 0, onSample: null };
  return {
    state,
    /** @type {any} */
    factory: ({ onSample }) => {
      state.onSample = onSample;
      return {
        start: () => {
          state.starts += 1;
          state.running = true;
        },
        stop: () => {
          state.stops += 1;
          state.running = false;
        },
        isRunning: () => state.running,
        sampleOnce: async () => null,
      };
    },
  };
}

/** @param {{ window?: any }} [options] */
function make({ window = { isDestroyed: () => false } } = {}) {
  const emitToRenderer = vi.fn();
  const fake = fakeTelemetry();
  const capability = createHudTelemetryCapability({
    emitToRenderer,
    getMainWindow: () => window,
    createTelemetry: fake.factory,
  });
  return { capability, emitToRenderer, state: fake.state };
}

function handlerFor(capability, channel) {
  const entry = capability.ipcHandlers.find((h) => h.channel === channel);
  if (!entry) throw new Error(`no handler for ${channel}`);
  return entry;
}

describe("createHudTelemetryCapability", () => {
  it("declares exactly the two lifecycle channels, both as sends", () => {
    const { capability } = make();
    expect(capability.ipcHandlers.map((h) => `${h.kind} ${h.channel}`).sort()).toEqual([
      "on hud-telemetry:activate",
      "on hud-telemetry:deactivate",
    ]);
  });

  it("contributes no tool declaration — the readout reaches no verb or prompt", () => {
    const { capability } = make();
    expect(capability.toolDeclarations).toEqual([]);
    expect(capability.promptFragment).toBeUndefined();
  });

  it("starts sampling on activate and stops on deactivate", () => {
    const { capability, state } = make();
    expect(state.running).toBe(false);
    handlerFor(capability, "hud-telemetry:activate").fn();
    expect(state.running).toBe(true);
    expect(capability.isSampling()).toBe(true);
    handlerFor(capability, "hud-telemetry:deactivate").fn();
    expect(state.running).toBe(false);
  });

  it("pushes each sample on its own channel, unchanged", () => {
    const { capability, emitToRenderer, state } = make();
    handlerFor(capability, "hud-telemetry:activate").fn();
    const sample = { at: 1786179827576, cpu: 0.13, gpu: 0.08, netRx: 18800, netTx: 372538 };
    state.onSample(sample);
    expect(emitToRenderer).toHaveBeenCalledWith("hud-telemetry:sample", sample);
  });

  it("stops itself, and pushes nothing, once the window is gone", () => {
    const window = { isDestroyed: () => true };
    const { capability, emitToRenderer, state } = make({ window });
    handlerFor(capability, "hud-telemetry:activate").fn();
    state.onSample({ at: 1, cpu: 0.5, gpu: null, netRx: null, netTx: null });
    expect(emitToRenderer).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
  });

  it("pushes nothing when there is no window at all", () => {
    const { capability, emitToRenderer, state } = make({ window: null });
    handlerFor(capability, "hud-telemetry:activate").fn();
    state.onSample({ at: 1, cpu: 0.5, gpu: null, netRx: null, netTx: null });
    expect(emitToRenderer).not.toHaveBeenCalled();
  });

  it("stops sampling on teardown", () => {
    const { capability, state } = make();
    handlerFor(capability, "hud-telemetry:activate").fn();
    capability.teardown();
    expect(state.running).toBe(false);
    expect(state.stops).toBeGreaterThan(0);
  });

  it("tears down cleanly having never sampled", () => {
    const { capability } = make();
    expect(() => capability.teardown()).not.toThrow();
  });
});
