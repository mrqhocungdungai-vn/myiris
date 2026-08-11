// The "thinking" detector: the user has stopped talking but Iris has not
// started speaking yet, and that gap gets the orbiting swirl.
//
// Driven entirely by the real microphone level, so it needs no extra events
// from the model — which is why it is a sampled state machine rather than
// something event-driven. Extracted from App.tsx so the four thresholds below
// can be exercised directly instead of only in real time at 120 ms a frame.
//
// The thresholds are the substance here. Each has a failure mode in one
// direction only, so none of them is arbitrary:

/** Above this input level the user is considered to be speaking. */
export const TALKING_LEVEL = 0.13;
/**
 * Silence this long after speech ends the utterance and starts the swirl.
 * Too short and an ordinary pause mid-sentence reads as a finished question.
 */
export const SILENCE_MS = 420;
/**
 * The swirl gives up after this long. A model that never answers must not
 * leave the orb thinking forever — an indicator that is always on says
 * nothing.
 */
export const THINKING_TIMEOUT_MS = 6000;
/** How often the level is sampled. */
export const SAMPLE_INTERVAL_MS = 120;

export type ThinkingState = {
  /** Whether the user is mid-utterance. */
  talking: boolean;
  /** When the level last exceeded TALKING_LEVEL. */
  lastLoudAt: number;
  /** When the current thinking gap began. */
  thinkingSince: number;
  /** Whether the swirl is showing. */
  thinking: boolean;
};

export const INITIAL_THINKING_STATE: ThinkingState = {
  talking: false,
  lastLoudAt: 0,
  thinkingSince: 0,
  thinking: false,
};

/** One sample's worth of input. */
export type ThinkingSample = {
  /** The current microphone input level. */
  level: number;
  /** True while Iris is speaking — which ends the gap immediately. */
  speaking: boolean;
  /** Now, in the same clock as the previous sample. */
  now: number;
};

/**
 * Advances the detector by one sample.
 *
 * Order matters: Iris speaking is tested first and wins over everything, since
 * the gap this measures is by definition the time before she speaks. Then a
 * loud sample (the user is talking, so not waiting), then the silence timeout
 * that opens the gap. The overall timeout is applied last so it can close a
 * gap opened on this very sample's clock.
 */
export function thinkingStep(state: ThinkingState, sample: ThinkingSample): ThinkingState {
  const { level, speaking, now } = sample;
  let next: ThinkingState = state;

  if (speaking) {
    next = { ...next, thinking: false, talking: false };
  } else if (level > TALKING_LEVEL) {
    next = { ...next, talking: true, lastLoudAt: now, thinking: false };
  } else if (next.talking && now - next.lastLoudAt > SILENCE_MS) {
    next = { ...next, talking: false, thinkingSince: now, thinking: true };
  }

  if (next.thinking && now - next.thinkingSince > THINKING_TIMEOUT_MS) {
    next = { ...next, thinking: false };
  }

  return next;
}
