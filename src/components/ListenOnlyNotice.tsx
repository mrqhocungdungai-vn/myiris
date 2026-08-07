import { Headphones, Mic, ShieldAlert } from "lucide-react";
import { SYSTEM_AUDIO_CAPTURE_DISCLOSURE } from "../lib/system-audio";

/**
 * The two things engaging listen-only mode has to say out loud
 * (listen-mode-hears-system-audio).
 *
 * `consent` is the FIRST-RUN consent point, and it is the reason meeting
 * retention needs no separate preference: engaging the mode is the deliberate,
 * per-session act that authorises it, so the first engage states what is
 * retained, that it may include other people, and where it is written. Shown
 * once, then remembered.
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
  onDismiss,
}: {
  kind: "consent" | "headphones" | "refused" | null;
  /** The tool that was refused, when `kind` is "refused". */
  tool?: string;
  onDismiss: () => void;
}) {
  if (!kind) return null;
  return (
    <div className={`listen-notice hud-hit ${kind === "refused" ? "refused" : ""}`} role="status">
      <span className="listen-notice-icon" aria-hidden="true">
        {kind === "consent" ? <Mic size={16} /> : kind === "refused" ? <ShieldAlert size={16} /> : <Headphones size={16} />}
      </span>
      <div className="listen-notice-body">
        {kind === "consent" ? (
          <>
            <strong>Iris is silent and listening.</strong> {SYSTEM_AUDIO_CAPTURE_DISCLOSURE} She writes what she
            hears to <code>inbox/meetings/</code> in your notes vault — one file per session. That can include other
            people in the room or on the call.
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
  );
}
