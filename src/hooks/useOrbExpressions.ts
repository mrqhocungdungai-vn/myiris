import { useEffect, useState } from "react";
import { INITIAL_THINKING_STATE, SAMPLE_INTERVAL_MS, thinkingStep } from "../lib/orb-thinking";

// The orb's micro-expressions: the "thinking" swirl, and the two animation
// keys that make the orb flash on wake and ripple when speech locks in.
//
// `wakeKey` and `rippleKey` are **counters, not booleans** — the orb replays
// its animation when the key changes, so a second wake while the first flash is
// still playing must produce a new value rather than re-setting `true` to
// `true`, which would do nothing visible. Incrementing is the mechanism, and it
// is the reason these are numbers.

export type OrbExpressions = {
  /** The gap between the user stopping and Iris starting — the orbiting swirl. */
  thinking: boolean;
  /** Bumped on every wake, replaying the flash. */
  wakeKey: number;
  /** Bumped when the user's own speech locks in. */
  rippleKey: number;
  /** The session woke. */
  wake: () => void;
  /** The session slept — the swirl stops, since there is nothing to wait for. */
  sleep: () => void;
  /** The user's own words just locked in. Never called for speech Iris merely overheard. */
  ripple: () => void;
};

export function useOrbExpressions({
  awake,
  inputLevelRef,
  audioStateRef,
}: {
  awake: boolean;
  inputLevelRef: { current: number };
  audioStateRef: { current: string };
}): OrbExpressions {
  const [thinking, setThinking] = useState(false);
  const [wakeKey, setWakeKey] = useState(0);
  const [rippleKey, setRippleKey] = useState(0);

  // "Thinking" detector: you stopped talking but Iris hasn't started speaking
  // yet. Driven by the real mic level, so it needs no extra events from the
  // model. The state machine and its four thresholds are in lib/orb-thinking,
  // where they are tested; this only samples and publishes the changes.
  useEffect(() => {
    if (!awake) return;
    let state = INITIAL_THINKING_STATE;

    const id = window.setInterval(() => {
      const next = thinkingStep(state, {
        level: inputLevelRef.current,
        speaking: audioStateRef.current === "speaking",
        now: performance.now(),
      });
      if (next.thinking !== state.thinking) setThinking(next.thinking);
      state = next;
    }, SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awake]);

  return {
    thinking,
    wakeKey,
    rippleKey,
    wake: () => setWakeKey((key) => key + 1),
    sleep: () => setThinking(false),
    ripple: () => setRippleKey((key) => key + 1),
  };
}
