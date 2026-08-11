import { useEffect, useState } from "react";
import {
  noticeForEngagement,
  noticeAfterTransition,
  consentWasStated,
  type ListenOnlyNotice,
} from "../lib/listen-only-notice";
import { readFlag, writeFlag, LISTEN_ONLY_CONSENT_STORAGE_KEY } from "../lib/preferences";

// Listen-only mode as the renderer sees it: engaged or not, how long the
// window has left, what Iris is hearing right now, and which notice to show.
//
// **Main owns the mode.** There is deliberately no report-back call anywhere in
// here — the renderer queries once on mount (so a window opened or reloaded
// mid-mode shows the true state, design.md D3), subscribes to main's one-way
// push, and does nothing but execute the audio drop and display the result.
//
// This hook does **not** touch the Comms panel. Revealing Comms while the mode
// is engaged is the panel's own behavior, driven from `engaged` through
// `lib/reveal-latch` — see `decompose-app-orchestrator` task 1.5. Writing it
// from in here is what made this domain look inseparable.

export type ListenOnlyState = {
  engaged: boolean;
  /** Absolute deadline for the listening window, or null when not running. */
  deadline: number | null;
  /** The live readout of what Iris is hearing. Ephemeral — never added to the transcript. */
  heardLive: string;
  notice: ListenOnlyNotice;
  /** The tool a refusal named, for the notice to quote. */
  refusedTool: string;
  setHeardLive: (text: string) => void;
  /** Main refused a tool call while the mode was engaged. */
  refuse: (tool: string) => void;
  dismissNotice: () => void;
};

export function useListenOnlyMode({
  hasBridge,
  applyAudio,
  outputIsSpeakers,
}: {
  hasBridge: boolean;
  /** Executes the audio drop for a new mode state. */
  applyAudio: (state: { engaged: boolean; systemAudio?: boolean }) => void;
  /** Whether output is going to speakers rather than headphones. Async, and advisory only. */
  outputIsSpeakers: () => Promise<boolean>;
}): ListenOnlyState {
  const [engaged, setEngaged] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [heardLive, setHeardLive] = useState("");
  const [notice, setNotice] = useState<ListenOnlyNotice>(null);
  const [refusedTool, setRefusedTool] = useState("");

  useEffect(() => {
    if (!hasBridge) return;
    window.iris.getListenOnlyState().then((state) => {
      setEngaged(state.engaged);
      // A window opened before this renderer existed is already running, so the
      // countdown picks up mid-flight rather than starting over.
      setDeadline(state.deadlineAt ?? null);
      applyAudio(state);
    });
    return window.iris.onListenOnlyState((state) => {
      setEngaged(state.engaged);
      setDeadline(state.deadlineAt ?? null);
      setHeardLive("");
      applyAudio(state);

      // Which notice to raise is `noticeAfterTransition`, where the consent
      // rule is asserted. The speaker check is async, so the disengaging edge
      // and the consent case — neither of which needs it — resolve first.
      const base = {
        engaged: state.engaged,
        systemAudio: Boolean(state.systemAudio),
        consentSeen: readFlag(LISTEN_ONLY_CONSENT_STORAGE_KEY, false),
      };
      const immediate = noticeAfterTransition(null, { ...base, outputIsSpeakers: false });
      if (!state.engaged || consentWasStated(immediate)) setNotice(immediate);
      // A notice we cannot remember is shown again next time; harmless.
      if (consentWasStated(immediate)) writeFlag(LISTEN_ONLY_CONSENT_STORAGE_KEY, true);
      else if (state.engaged && base.systemAudio) {
        outputIsSpeakers().then((speakers) => {
          const advice = noticeForEngagement({ ...base, outputIsSpeakers: speakers });
          if (advice) setNotice(advice);
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  return {
    engaged,
    deadline,
    heardLive,
    notice,
    refusedTool,
    setHeardLive,
    refuse(tool) {
      setRefusedTool(tool);
      setNotice("refused");
    },
    dismissNotice: () => setNotice(null),
  };
}
