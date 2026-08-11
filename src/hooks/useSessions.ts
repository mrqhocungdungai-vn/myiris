import { useEffect, useState } from "react";

// Claude workstreams, and the verb roster that belongs to whichever one is
// active.
//
// These are one domain rather than two because the roster is **keyed by the
// active session**: switching workstream re-reads it. Holding them apart is
// what would let a session's roster be shown against a different session.
//
// `applySessions` is the single normalizer for every snapshot main returns —
// select, create, choose-folder and the `claude_session` push all land here, so
// a malformed snapshot degrades the same way on all four paths instead of
// four times differently.

export type SessionsControl = {
  sessions: ClaudeSession[];
  activeId: string | null;
  active: ClaudeSession | null;
  /** The roster for the active session, or null while it is loading or failed. */
  verbs: VerbsSnapshot | null;
  /** What ran most recently in this workstream — a history, not a mode. */
  lastVerb: Verb | null;
  apply: (snapshot: SessionsSnapshot) => void;
  /** Re-read the roster without changing session — after a model change elsewhere. */
  refreshVerbs: () => void;
  /** Switch workstream. A no-op for the one already active. */
  choose: (id: string) => Promise<void>;
  create: () => Promise<void>;
  /** Pick the project folder for the active workstream. */
  chooseProjectFolder: () => Promise<void>;
};

export function useSessions({
  hasBridge,
  onLog,
}: {
  hasBridge: boolean;
  onLog: (level: string, message: string) => void;
}): SessionsControl {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [verbs, setVerbs] = useState<VerbsSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!hasBridge) return;
    window.iris
      .listVerbs(activeId ?? undefined)
      .then(setVerbs)
      .catch(() => setVerbs(null));
  }, [hasBridge, activeId, sessions, tick]);

  const active = sessions.find((entry) => entry.id === activeId) ?? null;

  function apply(snapshot: SessionsSnapshot) {
    setSessions(Array.isArray(snapshot.sessions) ? snapshot.sessions : []);
    setActiveId(typeof snapshot.active === "string" ? snapshot.active : null);
  }

  return {
    sessions,
    activeId,
    active,
    verbs,
    // One verb per request, so a workstream has a history, not a mode.
    lastVerb: active?.last_verb_used ?? null,
    apply,

    // The commands that mutate this state live with it — each one ends in
    // `apply`, so the normalizer stays the single way a snapshot lands.
    async choose(id) {
      if (!hasBridge || !id || id === activeId) return;
      const snapshot = await window.iris.selectSession(id);
      apply(snapshot);
      const label = snapshot.sessions?.find((entry) => entry.id === id)?.label ?? id;
      onLog("info", `Claude session switched to ${label}`);
    },

    async create() {
      if (!hasBridge) return;
      apply(await window.iris.newSession());
    },

    async chooseProjectFolder() {
      if (!hasBridge) return;
      const snapshot = await window.iris.chooseProjectFolder(activeId ?? undefined);
      if (snapshot.status === "error") {
        onLog("error", snapshot.error ?? "Could not set the project folder.");
        return;
      }
      apply(snapshot);
    },
    refreshVerbs: () => setTick((current) => current + 1),
  };
}
