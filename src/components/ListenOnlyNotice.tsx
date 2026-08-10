import { useEffect, useState } from "react";
import { Headphones, Mic, ShieldAlert, Timer } from "lucide-react";
import { SYSTEM_AUDIO_CAPTURE_DISCLOSURE } from "../lib/system-audio";

/**
 * What engaging listen-only mode has to say out loud
 * (listen-mode-hears-system-audio), plus the time it has left
 * (listen-window-is-bounded).
 *
 * The COUNTDOWN is not one of the notices: it is shown for as long as the
 * window is open and cannot be dismissed, because Iris is silent while engaged
 * and cannot warn by voice that the mode is about to end. It is the warning. A
 * notice the user can wave away would leave them to discover the end by Iris
 * suddenly speaking.
 *
 * It counts down locally from the absolute deadline main pushed with the mode
 * state — main owns expiry, the renderer only renders. If the two clocks
 * disagree the number is briefly wrong; it can never change when the mode
 * actually ends.
 *
 * `consent` is the FIRST-RUN consent point: engaging the mode is the deliberate,
 * per-session act that authorises the capture, so the first engage states what
 * Iris hears and that it may include other people. It promises no record,
 * because none is written.
 *
 * `headphones` is advisory and never blocks — speaker output re-enters the
 * microphone and reaches Iris a second time, degraded and out of step with the
 * captured copy. Iris does nothing to cancel or duck that second copy: a
 * ducking bug eats the user's own voice, which is invisible until it matters,
 * whereas degraded transcription is recoverable.
 *
 * `refused` reports that something Iris overheard tried to make her act, and
 * was stopped. It has to be visible: a refusal nobody sees is indistinguishable
 * from Iris quietly doing the work anyway, and the user has no other way to
 * learn that the audio in the room is trying to spend their money.
 *
 * Rendered at App level rather than inside CenterStage or HudShell so both
 * surfaces show the identical text — `hud-hit` opts it into pointer events in
 * HUD mode, where the window is otherwise click-through.
 */
export default function ListenOnlyNotice({
  kind,
  tool,
  deadlineAt,
  onDismiss,
}: {
  kind: "consent" | "headphones" | "refused" | null;
  /** The tool that was refused, when `kind` is "refused". */
  tool?: string;
  /** The listening window's absolute deadline, or null when no window is open. */
  deadlineAt?: number | null;
  onDismiss: () => void;
}) {
  const remaining = useWindowCountdown(deadlineAt ?? null);
  if (!kind && remaining === null) return null;
  return (
    <div className="listen-notice-stack">
      {remaining !== null ? (
        <div className="listen-notice hud-hit listening-window" role="status">
          <span className="listen-notice-icon" aria-hidden="true">
            <Timer size={16} />
          </span>
          <div className="listen-notice-body">
            <strong>Listening — {formatRemaining(remaining)} left.</strong> Iris goes back to speaking on her own when
            this runs out. Ask her about what she heard then; nothing is written down.
          </div>
        </div>
      ) : null}
      {kind ? (
        <div className={`listen-notice hud-hit ${kind === "refused" ? "refused" : ""}`} role="status">
          <span className="listen-notice-icon" aria-hidden="true">
            {kind === "consent" ? <Mic size={16} /> : kind === "refused" ? <ShieldAlert size={16} /> : <Headphones size={16} />}
          </span>
          <div className="listen-notice-body">
            {kind === "consent" ? (
              <>
                <strong>Iris is silent and listening.</strong> {SYSTEM_AUDIO_CAPTURE_DISCLOSURE} That can include other
                people in the room or on the call. Nothing is saved to disk — what she hears stays in this
                conversation, so ask her about it once the mode ends.
              </>
            ) : kind === "refused" ? (
              <>
                <strong>Blocked a request Iris overheard.</strong> Something in the audio asked her to run{" "}
                <code>{tool || "a task"}</code>, and she refused — while she is listening silently, nothing she hears
                counts as an instruction from you. Nothing ran and nothing was charged.
              </>
            ) : (
              <>
                <strong>Headphones recommended.</strong> Your audio is going to speakers, so every remote voice reaches
                Iris twice — once captured, once back through the microphone. She will still work; the transcript is
                just cleaner on headphones.
              </>
            )}
          </div>
          <button className="listen-notice-dismiss" onClick={onDismiss} title="Dismiss">
            Got it
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Milliseconds left on the window, or null when none is open.
 *
 * Ticks once a second locally rather than being pushed per second over IPC: the
 * deadline is absolute, so the renderer can compute this, and the transition
 * push stays the one authority for the mode. The interval is torn down the
 * moment the deadline is gone, so nothing runs while Iris is audible.
 */
function useWindowCountdown(deadlineAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (deadlineAt === null) {
      setRemaining(null);
      return;
    }
    const read = () => setRemaining(Math.max(0, deadlineAt - Date.now()));
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  return remaining;
}

/** "4:32" / "0:07" — a clock, because that is how a person reads a countdown. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
