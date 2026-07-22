import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { AGENT_LABELS } from "../lib/agents";

/**
 * Work Stream chat switcher: shows the workstream Iris is talking in, opens a
 * picker of past workstreams, and starts a fresh one with the + button.
 * Rebound to our `sessions:get/select/new` IPC (design D3) — no Hermes
 * session IPC. The active row also surfaces the active role's Claude Code
 * session id (`who ▸ id`), matching the previous `.claude-session-line`.
 */
export default function SessionSwitcher({
  session,
  sessions,
  onSwitch,
  onNew,
}: {
  session: ClaudeSession | null;
  sessions: ClaudeSession[];
  onSwitch: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chipLabel = session?.label ?? "Session 1 (new)";
  const activeAgent = session?.active_agent ?? null;
  const claudeId = session?.agent_sessions?.[activeAgent ?? "default"];
  const who = activeAgent ? AGENT_LABELS[activeAgent] : "Iris";

  return (
    <>
      <div className="session-bar" ref={rootRef}>
        <button
          type="button"
          className={`session-chip ${open ? "open" : ""}`}
          onClick={() => setOpen((current) => !current)}
          title="Claude workstreams — click to switch"
        >
          <span className="session-dot" />
          <span className="session-id">{chipLabel}</span>
          <ChevronDown size={12} className="chev" />
        </button>
        <button
          type="button"
          className="session-new"
          data-no-dwell
          onClick={onNew}
          title="Start a new Claude session (clean slate)"
        >
          <Plus size={13} />
        </button>

        {open ? (
          <div className="session-menu">
            <div className="session-menu-head">Claude workstreams</div>
            {sessions.length === 0 ? (
              <div className="session-empty">A Claude session starts with the first task.</div>
            ) : (
              sessions.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`session-item ${entry.id === session?.id ? "sel" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (entry.id !== session?.id) onSwitch(entry.id);
                  }}
                >
                  <span className="session-item-main">
                    <strong>{entry.label}</strong>
                    <em>{entry.cwd ? entry.cwd.split("/").filter(Boolean).pop() : "default workspace"}</em>
                  </span>
                  {entry.id === session?.id ? <Check size={13} /> : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div
        className={`claude-session-line ${claudeId ? "resumes" : "fresh"}`}
        title={
          claudeId
            ? `Every ${who} task resumes exactly this Claude Code session id — press New to start over with a clean context`
            : `No Claude conversation for ${who} yet — the first task creates the id and it sticks until you press New`
        }
      >
        {claudeId ? `${who} ▸ ${claudeId}` : `${who} ▸ new — id is created by the first task`}
      </div>
    </>
  );
}
