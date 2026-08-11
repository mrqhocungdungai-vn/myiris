import { useState } from "react";
import { ChevronDown, Clock, Maximize2, Minimize2, MessageSquare } from "lucide-react";
import ContextSupplementInput from "./ContextSupplementInput";
import HudCamera from "./HudCamera";
import { transcriptVoice, transcriptVoiceLabel } from "../lib/transcript-speaker";
import { HUD_CHROME_CLASS } from "../lib/hudChrome";
import type { LogLine, TranscriptLine } from "../types";
import type { HandState } from "../hooks/useHandControl";
import type { EyeState } from "../hooks/useEyeTracking";
import type { TokenAlertSeenRef, TokenLedgerRef } from "../hooks/useTokenLedger";

// The HUD's left column: Comms, and the camera frame with its own controls.
//
// `stampOn` lives here rather than in `HudShell` or `App` for the reason its
// comment always gave — the control sits in this column beside the camera-size
// button, and the stamp it drives renders inside the frame. Both are now in one
// component, so the state finally sits where that sentence says it should.
//
// It is deliberately **not persisted** (design D3): a REC indicator restored
// from disk would claim a recording that is not happening. Off on every launch.
// And it wears REC vocabulary because that is what reads as "this footage is
// timestamped" to an audience — the app records nothing, and the button's title
// says what it actually does. Never label it start/stop recording, and never
// give it an elapsed timer or a file readout: those are the affordances only a
// real recorder has.

export default function HudLeftColumn({
  awake,
  recentTranscript,
  commsOpen,
  onToggleComms,
  commsScrollRef,
  onSendSupplement,
  handControl,
  hand,
  handRef,
  handStream,
  eye,
  eyeRef,
  telemetryRef,
  ledgerRef,
  alertSeenRef,
  logs,
  handActionLabel,
  handActionTone,
  cameraEnlarged,
  onToggleCameraSize,
}: {
  /** The session is up — gates the supplement input. */
  awake: boolean;
  recentTranscript: TranscriptLine[];
  commsOpen: boolean;
  onToggleComms: () => void;
  commsScrollRef: React.RefObject<HTMLDivElement | null>;
  onSendSupplement: (text: string) => void;
  handControl: boolean;
  hand: HandState;
  handRef: { current: HandState };
  handStream: MediaStream | null;
  eye: EyeState;
  eyeRef: { current: EyeState };
  telemetryRef: { current: TelemetrySample };
  ledgerRef: TokenLedgerRef;
  alertSeenRef: TokenAlertSeenRef;
  logs: LogLine[];
  handActionLabel: string;
  handActionTone: string;
  cameraEnlarged: boolean;
  onToggleCameraSize: () => void;
}) {
  const [stampOn, setStampOn] = useState(false);

  return (
    <div className={`hud-left ${HUD_CHROME_CLASS}`}>
      {recentTranscript.length > 0 ? (
        <>
          <button
            type="button"
            className={`hud-comms-toggle hud-hit ${commsOpen ? "open" : ""}`}
            onClick={onToggleComms}
            title={commsOpen ? "Collapse conversation" : "Show conversation"}
          >
            <MessageSquare size={12} />
            Comms
            <span className="count">{recentTranscript.length}</span>
            <ChevronDown size={12} className="chev" />
          </button>
          {commsOpen ? (
            <>
              <div className="hud-comms hud-hit" ref={commsScrollRef}>
                {recentTranscript.map((line) => {
                  const voice = transcriptVoice(line.speaker);
                  return (
                    <div className={`bubble ${voice}`} key={line.id}>
                      <span className="who">{transcriptVoiceLabel(voice)}</span>
                      {line.text}
                    </div>
                  );
                })}
              </div>
              <div className="hud-hit">
                <ContextSupplementInput disabled={!awake} onSubmit={onSendSupplement} />
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {handControl ? (
        <>
          {/* A row of camera controls ABOVE the frame, so they keep
              `.hud-left`'s 300px width and do not move when the frame
              resizes. `.hud-hit` is not optional on either: HUD mode is
              click-through by default, so a control without it cannot be
              clicked at all. */}
          <div className="hud-camera-controls">
            <button
              type="button"
              className={`hud-comms-toggle hud-camera-size hud-hit ${cameraEnlarged ? "open" : ""}`}
              onClick={onToggleCameraSize}
              title={cameraEnlarged ? "Return the camera to its standard size" : "Enlarge the camera for streaming"}
            >
              {cameraEnlarged ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              Cam
              <span className="count">{cameraEnlarged ? "+35%" : "1×"}</span>
            </button>
            {/* hud-rec-timestamp. It wears REC vocabulary because that is
                what reads as "this footage is timestamped" to an audience —
                but the app records nothing, and the title says what it
                actually does. Never label this start/stop recording, and
                never give it an elapsed timer or a file readout: those are
                the affordances only a real recorder has (spec: "The
                recording indicator SHALL NOT imply the app is capturing
                video"). */}
            <button
              type="button"
              className={`hud-comms-toggle hud-camera-rec hud-hit ${stampOn ? "open" : ""}`}
              onClick={() => setStampOn((current) => !current)}
              title={
                stampOn
                  ? "Hide the date and time on the camera"
                  : "Show the date and time on the camera (Iris records nothing — this only stamps the picture)"
              }
            >
              <Clock size={12} />
              Rec
              <span className="count">{stampOn ? "on" : "off"}</span>
            </button>
          </div>
          <HudCamera
            stream={handStream}
            hand={hand}
            handRef={handRef}
            eye={eye}
            eyeRef={eyeRef}
            telemetryRef={telemetryRef}
            ledgerRef={ledgerRef}
            alertSeenRef={alertSeenRef}
            logs={logs}
            actionLabel={handActionLabel}
            actionTone={handActionTone}
            enlarged={cameraEnlarged}
            stampOn={stampOn}
          />
        </>
      ) : null}
    </div>
  );
}
