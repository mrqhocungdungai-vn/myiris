// The Permissions step's system-audio self-test: which verdict a run produces,
// and what each verdict tells the user (setup-panel: "The Permissions step
// names system audio and can test it").
//
// The resolution lives here rather than in the component because the repo has
// no React component-test harness — every `src/` test targets `src/lib/` or a
// hook — and the four outcomes are exactly the part worth asserting
// (setup-panel-reports-real-permissions 4.10). The component runs the capture
// and hands the facts to these functions.

import { SYSTEM_AUDIO_CAPTURE_DISCLOSURE } from "./system-audio";

/**
 * The oldest macOS that provides system-audio capture at all.
 *
 * The bundle used to declare a minimum of 12.0 and the code gated on nothing
 * but `darwin`, so on 12 or 13 the capture is not broken — it is absent, and
 * the self-test would report bit-exact silence forever with no explanation,
 * sending the user after a permission that cannot help (D8).
 */
export const MIN_SYSTEM_AUDIO_MACOS = "14.2";

/**
 * Four outcomes, because the action that resolves each one differs.
 *
 * `silent` is the observed failure that otherwise looks identical to working
 * until a meeting has already been recorded to nothing.
 */
export type SystemAudioSelfTestVerdict = "heard" | "silent" | "not-obtainable" | "os-too-old";

/** Numeric comparison of dotted versions — `10` sorts above `9`, unlike a string compare. */
export function compareVersions(a: string, b: string): number {
  const left = String(a ?? "").split(".");
  const right = String(b ?? "").split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = Number.parseInt(left[i] ?? "0", 10) || 0;
    const y = Number.parseInt(right[i] ?? "0", 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether this operating system provides the capture at all.
 *
 * An unknown version is treated as capable: refusing to test on a version we
 * failed to read would report an OS problem we have no evidence of, and the
 * capture attempt itself gives a real answer either way.
 */
export function supportsSystemAudioCapture(osVersion: string | null | undefined): boolean {
  if (!osVersion) return true;
  return compareVersions(osVersion, MIN_SYSTEM_AUDIO_MACOS) >= 0;
}

/**
 * The verdict, from what the run actually observed.
 *
 * The version is resolved BEFORE the capture is attempted, so "this OS does
 * not provide it" is never reported as silence.
 */
export function resolveSelfTestVerdict({
  osVersion,
  acquired,
  heard,
}: {
  osVersion?: string | null;
  acquired: boolean;
  heard?: boolean;
}): SystemAudioSelfTestVerdict {
  if (!supportsSystemAudioCapture(osVersion)) return "os-too-old";
  if (!acquired) return "not-obtainable";
  return heard ? "heard" : "silent";
}

export interface SelfTestVerdictCopy {
  /** Whether Iris can hear the machine — the question the test exists to answer. */
  ok: boolean;
  headline: string;
  detail: string;
  /**
   * Whether to offer the route to the system-audio recording settings.
   *
   * Offered on both failing verdicts, because the governing permission is
   * unreadable but NOT absent — a user who once refused that prompt is
   * otherwise stranded with a verdict that never changes and nothing to act
   * on. Never offered for `os-too-old`: there is no setting that can help, and
   * sending them to look for one is the same untruth in a new place.
   */
  offersSettingsRoute: boolean;
}

const VERDICT_COPY: Record<SystemAudioSelfTestVerdict, SelfTestVerdictCopy> = {
  heard: {
    ok: true,
    headline: "Iris can hear your machine.",
    detail: "Audio arrived from the system capture. Listen-only mode will hear your meetings.",
    offersSettingsRoute: false,
  },
  silent: {
    ok: false,
    headline: "Nothing heard.",
    // The test cannot distinguish a blocked capture from a quiet one, because
    // the failure it exists to catch IS bit-exact silence. Saying so is the
    // difference between a user checking their speakers and a user concluding
    // their setup is broken.
    detail:
      "The capture opened but every sample was silent. That is expected if nothing was playing — " +
      "start some audio and test again. If it stays silent while sound is playing, check the recording permission below.",
    offersSettingsRoute: true,
  },
  "not-obtainable": {
    ok: false,
    headline: "Could not capture system audio.",
    detail:
      "Iris could not open a capture of your machine's audio at all. Check the recording permission below.",
    offersSettingsRoute: true,
  },
  "os-too-old": {
    ok: false,
    headline: `This macOS does not provide system-audio capture.`,
    detail:
      `Capturing what your machine plays needs macOS ${MIN_SYSTEM_AUDIO_MACOS} or newer. ` +
      "Listen-only mode still works — Iris will hear the room through your microphone, but not the call.",
    // No permission to check: the capability is absent, not refused.
    offersSettingsRoute: false,
  },
};

export function describeSelfTestVerdict(verdict: SystemAudioSelfTestVerdict): SelfTestVerdictCopy {
  return VERDICT_COPY[verdict];
}

/**
 * What running the test itself does, disclosed before it runs.
 *
 * Pressing it starts the same capture the mode does and may raise the
 * operating system's own recording prompt, so it is disclosed on the mode's
 * own terms — and it reuses the mode's one description of what is captured
 * rather than authoring a second.
 */
export const SELF_TEST_DISCLOSURE =
  `Running this opens a capture of your machine's audio for a few seconds and may raise macOS's own ` +
  `recording prompt. ${SYSTEM_AUDIO_CAPTURE_DISCLOSURE}`;
