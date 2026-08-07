// The SetupPanel's Permissions step (setup-panel: "The Permissions step
// reports the operating system's answer", "A refused permission routes to
// where it can be changed", "The Permissions step names system audio and can
// test it").
//
// Split out of SetupPanel.tsx, which was 1175 lines against a 250–450
// convention and would have gained three more permission concerns
// (setup-panel-reports-real-permissions D7). It renders from two call sites —
// the settings body and the wizard step — and owns all the state it needs, so
// the panel passes only the device-selector props it already computes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, ExternalLink, Loader2, Mic, Play, Speaker } from "lucide-react";
import { Section, ThemedSelect, type Option } from "./SetupControls";
import { SYSTEM_DEFAULT_MIC } from "../lib/mic-device";
import {
  LIVENESS_PROBE_INTERVAL_MS,
  LIVENESS_PROBE_TICKS,
  SYSTEM_AUDIO_CAPTURE_DISCLOSURE,
  watchCaptureLiveness,
} from "../lib/system-audio";
import {
  SELF_TEST_DISCLOSURE,
  describeSelfTestVerdict,
  resolveSelfTestVerdict,
  type SystemAudioSelfTestVerdict,
} from "../lib/system-audio-self-test";

const SYSTEM_DEFAULT_CAMERA = "default";

/** How long the verdict waits before giving up on the liveness watch. */
const SELF_TEST_TIMEOUT_MS = LIVENESS_PROBE_INTERVAL_MS * LIVENESS_PROBE_TICKS + 1000;

type SelfTestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; verdict: SystemAudioSelfTestVerdict };

const EMPTY_SNAPSHOT: OsPermissionsSnapshot = {
  states: {},
  locations: { microphone: null, camera: null, "system-audio": null },
  osVersion: null,
};

export default function PermissionsStep({
  cameraDeviceId,
  onChangeCameraDevice,
  micDeviceId,
  onChangeMicDevice,
}: {
  cameraDeviceId: string;
  onChangeCameraDevice: (id: string) => void;
  micDeviceId: string;
  onChangeMicDevice: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<OsPermissionsSnapshot>(EMPTY_SNAPSHOT);
  const [pending, setPending] = useState<OsPermission | null>(null);
  // Permissions observed turning granted while this process has been running.
  // macOS does not always hand a fresh grant to an already-running process, so
  // a row reading granted while Iris still cannot capture would be the same
  // untruth this step exists to remove — said rather than hidden.
  const [grantedThisSession, setGrantedThisSession] = useState<Set<OsPermission>>(new Set());
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true);
  const [selfTest, setSelfTest] = useState<SelfTestState>({ status: "idle" });

  const mic = snapshot.states.microphone ?? "not-determined";
  const cam = snapshot.states.camera ?? "not-determined";

  // The state as of the last read, so a TRANSITION to granted can be spotted.
  // A permission already granted when the panel opened is not a transition —
  // that grant predates the process and is in effect.
  const lastStates = useRef<OsPermissionsSnapshot["states"] | null>(null);

  const refresh = useCallback(async () => {
    const next = await window.iris.queryOsPermissions();
    const previous = lastStates.current;
    if (previous) {
      const turned = (Object.keys(next.states) as OsPermission[]).filter(
        (permission) => next.states[permission] === "granted" && previous[permission] !== "granted",
      );
      if (turned.length) {
        setGrantedThisSession((current) => {
          const updated = new Set(current);
          for (const permission of turned) updated.add(permission);
          return updated;
        });
      }
    }
    lastStates.current = next.states;
    setSnapshot(next);
  }, []);

  // Freshness comes from focus, not polling (D2). macOS offers no change
  // notification for these, and granting one means leaving for System Settings
  // and coming back — so focus is the moment the answer can have changed. A
  // poll would add a recurring main-process wake to catch a case that on macOS
  // essentially cannot happen.
  useEffect(() => {
    refresh();
    window.iris.getListenOnlyState().then((state) => setSystemAudioEnabled(state.systemAudio));
    return window.iris.onWindowFocus(({ focused }) => {
      if (focused) refresh();
    });
  }, [refresh]);

  // Device labels only come through once the OS has granted the permission, so
  // each picker stays hidden until then — gated on the OS's answer, not the
  // renderer's view of it (spec: "Selectors gate on the same state"). While
  // granted, keep the list live so a device that appears or disappears at
  // runtime (e.g. starting OBS Virtual Camera) shows up without reopening
  // Settings.
  useEffect(() => {
    if (cam !== "granted") {
      setCamDevices([]);
      return;
    }
    return watchDevices("videoinput", setCamDevices);
  }, [cam]);

  useEffect(() => {
    if (mic !== "granted") {
      setMicDevices([]);
      return;
    }
    return watchDevices("audioinput", setMicDevices);
  }, [mic]);

  // `askForMediaAccess` in main, not `getUserMedia` here (D3): it asks the OS
  // and resolves to the OS's answer, where getUserMedia conflates asking with
  // opening a stream and its resolution says nothing about the OS's state —
  // which is the defect this step exists to fix.
  async function request(permission: OsPermission) {
    setPending(permission);
    try {
      const { state } = await window.iris.requestOsPermission(permission);
      if (state === "granted") await unlockDeviceLabels(permission);
      // refresh() spots the transition to granted itself, so an in-app grant
      // and one made in System Settings are reported the same way.
      await refresh();
    } finally {
      setPending(null);
    }
  }

  const permissionRow = (permission: OsPermission, icon: React.ReactNode, label: string, required: boolean) => (
    <PermRow
      key={permission}
      icon={icon}
      label={label}
      required={required}
      state={snapshot.states[permission] ?? "not-determined"}
      location={snapshot.locations[permission]}
      busy={pending === permission}
      justGranted={grantedThisSession.has(permission)}
      onRequest={() => request(permission)}
    />
  );

  return (
    <Section title="Permissions" hint="Iris needs your mic to hear you. Camera is optional (hand gestures).">
      <div className="setup-perms">
        {permissionRow("microphone", <Mic size={16} />, "Microphone", true)}
        {permissionRow("camera", <Camera size={16} />, "Camera (gestures)", false)}
      </div>
      <label className="setup-field">
        <span>Microphone</span>
        {mic === "granted" ? (
          <ThemedSelect
            ariaLabel="Microphone"
            value={micDeviceId}
            options={micOptions(micDevices, micDeviceId)}
            onChange={onChangeMicDevice}
          />
        ) : (
          <p className="setup-note">Grant Microphone permission above to choose a specific device.</p>
        )}
        <small className="setup-note">
          Governs both voice conversation and local “Hey Iris” wake-word listening — pick a specific device (e.g. a
          USB mic) instead of the system default. Applies immediately to whichever is currently listening. If the
          chosen device fails or is unplugged, Iris automatically falls back to System Default rather than going
          silent.
        </small>
      </label>
      <label className="setup-field">
        <span>Gesture camera</span>
        {cam === "granted" ? (
          <ThemedSelect
            ariaLabel="Gesture camera"
            value={cameraDeviceId}
            options={cameraOptions(camDevices, cameraDeviceId)}
            onChange={onChangeCameraDevice}
          />
        ) : (
          <p className="setup-note">Grant Camera permission above to choose a specific device.</p>
        )}
        <small className="setup-note">
          Which camera gesture control reads from — pick a specific device (e.g. OBS Virtual Camera) instead of the
          system default. Applies immediately, including while gesture control is running.
        </small>
      </label>
      <SystemAudioEntry
        enabled={systemAudioEnabled}
        osVersion={snapshot.osVersion}
        location={snapshot.locations["system-audio"]}
        state={selfTest}
        onStateChange={setSelfTest}
      />
    </Section>
  );
}

/**
 * Makes device labels readable after a grant, if they are not already.
 *
 * `enumerateDevices` exposes labels on the BROWSER ENGINE's own permission
 * check, which the swap from `getUserMedia` to `askForMediaAccess` (D3) no
 * longer performs — and the app installs no `setPermissionCheckHandler` to
 * answer it. Rather than guess which way that falls, this checks: if labels
 * are already there, it does nothing; if they are blank, it opens one stream
 * and stops it immediately, which unlocks them and confirms capture actually
 * works post-grant. A failure here costs only the labels, so it is swallowed —
 * the picker falls back to "Microphone 1" / "Camera 1".
 */
async function unlockDeviceLabels(permission: OsPermission) {
  const kind = permission === "microphone" ? "audioinput" : "videoinput";
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === kind,
    );
    if (!devices.length || devices.some((device) => device.label)) return;
    const stream = await navigator.mediaDevices.getUserMedia(
      permission === "microphone" ? { audio: true } : { video: true },
    );
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Labels stay blank; the picker names devices by index instead.
  }
}

/** Live-refreshed device enumeration for one kind. Returns its own teardown. */
function watchDevices(kind: MediaDeviceKind, set: (devices: MediaDeviceInfo[]) => void) {
  let cancelled = false;
  const refresh = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) set(devices.filter((device) => device.kind === kind));
    } catch {
      // Leave the list as-is; enumeration can fail transiently.
    }
  };
  refresh();
  navigator.mediaDevices.addEventListener?.("devicechange", refresh);
  return () => {
    cancelled = true;
    navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  };
}

function cameraOptions(devices: MediaDeviceInfo[], selected: string): Option[] {
  const options: Option[] = [{ value: SYSTEM_DEFAULT_CAMERA, label: "System Default" }].concat(
    devices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    })),
  );
  if (selected !== SYSTEM_DEFAULT_CAMERA && !devices.some((device) => device.deviceId === selected)) {
    options.push({ value: selected, label: "Previously selected camera (unavailable)" });
  }
  return options;
}

function micOptions(devices: MediaDeviceInfo[], selected: string): Option[] {
  const options: Option[] = [{ value: SYSTEM_DEFAULT_MIC, label: "System Default" }].concat(
    devices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    })),
  );
  // Unlike the camera list, this entry is self-correcting: once either mic
  // consumer actually tries to open the missing device it auto-falls-back to
  // System Default and App.tsx reconciles micDeviceId to match, at which
  // point this condition stops matching on its own — no extra "already
  // corrected" flag needed.
  if (selected !== SYSTEM_DEFAULT_MIC && !devices.some((device) => device.deviceId === selected)) {
    options.push({ value: selected, label: "Previously selected microphone (unavailable)" });
  }
  return options;
}

/**
 * The route to where a permission can actually be changed.
 *
 * The written path is shown alongside the link ALWAYS, not as an error
 * fallback — `shell.openExternal` resolves successfully even when the anchor
 * has been renamed and System Settings lands on the wrong page, so the app
 * cannot detect that case. The written path is what remains when the link
 * rots (D4).
 */
function SettingsRoute({ location }: { location: OsPermissionSettingsLocation | null }) {
  if (!location) return null;
  return (
    <div className="setup-perm-route">
      <button
        type="button"
        className="setup-btn ghost"
        onClick={() => window.iris.openPermissionSettings(location.permission)}
      >
        <ExternalLink size={13} />
        Open System Settings
      </button>
      <small className="setup-note">{location.writtenPath}</small>
    </div>
  );
}

function PermRow({
  icon,
  label,
  required,
  state,
  location,
  busy,
  justGranted,
  onRequest,
}: {
  icon: React.ReactNode;
  label: string;
  required?: boolean;
  state: OsPermissionState;
  location: OsPermissionSettingsLocation | null;
  busy: boolean;
  justGranted: boolean;
  onRequest: () => void;
}) {
  return (
    <div className={`setup-perm ${state}`}>
      <div className="setup-perm-head">
        <span className="perm-icon">{icon}</span>
        <span className="perm-label">
          {label}
          {required ? <em>required</em> : <em>optional</em>}
        </span>
        {state === "granted" ? (
          <span className="setup-result ok">
            <Check size={13} />
            Granted
          </span>
        ) : state === "not-determined" ? (
          // The one state where asking still works. Once macOS has recorded a
          // refusal it does not prompt again, so offering a retry anywhere else
          // is offering an action whose only outcome is the failure it was
          // offered to resolve.
          <button className="setup-btn ghost" onClick={onRequest} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : null}
            Allow
          </button>
        ) : (
          <span className="setup-result err">{state === "restricted" ? "Managed" : "Not granted"}</span>
        )}
      </div>
      {state === "restricted" ? (
        <small className="setup-note">
          This permission is managed by a device policy. You cannot grant it here, and asking would return without
          prompting — an administrator has to change it.
        </small>
      ) : null}
      {state === "denied" || state === "restricted" ? <SettingsRoute location={location} /> : null}
      {state === "granted" && justGranted ? (
        <small className="setup-note">
          If Iris still cannot use this, quit and reopen the app — macOS does not always hand a fresh grant to a
          running process.
        </small>
      ) : null}
    </div>
  );
}

/**
 * System audio: a test, not a grant.
 *
 * A grant is the wrong affordance because the governing permission cannot be
 * READ, not because none exists. macOS has a system-audio recording permission
 * distinct from screen recording, and the platform interface available here
 * reports microphone, camera and screen only — measured, the audio-only
 * capture delivers audio while `getMediaAccessStatus("screen")` reads denied.
 * A row built on that would report the wrong permission confidently, so this
 * one reports what trying produces.
 */
function SystemAudioEntry({
  enabled,
  osVersion,
  location,
  state,
  onStateChange,
}: {
  enabled: boolean;
  osVersion: string | null;
  location: OsPermissionSettingsLocation | null;
  state: SelfTestState;
  onStateChange: (state: SelfTestState) => void;
}) {
  // The epoch guard from useAudioPipeline: a run that has been superseded (by
  // unmount, or by a second press) must not report its verdict or leave its
  // capture open.
  const epoch = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      epoch.current += 1;
      cleanup.current?.();
      cleanup.current = null;
      window.iris.disarmSystemAudioSelfTest();
    },
    [],
  );

  async function run() {
    const mine = ++epoch.current;
    cleanup.current?.();
    onStateChange({ status: "running" });

    // The version is resolved BEFORE the capture is attempted (D8): below the
    // floor the capture is absent rather than broken, and reporting bit-exact
    // silence there would send the user after a setting that cannot help.
    const early = resolveSelfTestVerdict({ osVersion, acquired: false });
    if (early === "os-too-old") {
      onStateChange({ status: "done", verdict: "os-too-old" });
      return;
    }

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let cancelWatch: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (verdict: SystemAudioSelfTestVerdict) => {
      if (timeout) clearTimeout(timeout);
      cancelWatch?.();
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => {});
      cleanup.current = null;
      window.iris.disarmSystemAudioSelfTest();
      // Superseded runs still tear their capture down — they just do not
      // report. "No capture remains open" holds whatever the verdict and
      // whether or not the user stayed on the panel.
      if (mine === epoch.current) onStateChange({ status: "done", verdict });
    };
    cleanup.current = () => finish("not-obtainable");

    try {
      // Main arms exactly one grant, for this frame, on its own deadline. The
      // renderer asks; it cannot keep the arming alive.
      await window.iris.armSystemAudioSelfTest();
      stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true });
      if (!stream.getAudioTracks().length) throw new Error("the capture carried no audio track");
      if (mine !== epoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      // The same determination listen-only mode uses, so the panel and the
      // mode cannot disagree about whether Iris is hearing anything.
      cancelWatch = watchCaptureLiveness({
        analyser,
        onSilent: () => finish("silent"),
        onLive: () => finish("heard"),
      });
      // watchCaptureLiveness only reports; nothing bounds how long it probes if
      // the analyser stalls. The capture must not outlive its verdict.
      timeout = setTimeout(() => finish("silent"), SELF_TEST_TIMEOUT_MS);
    } catch {
      finish("not-obtainable");
    }
  }

  if (!enabled) {
    // No capture is reachable by any route in this configuration, so a test
    // could only report a failure the user chose.
    return (
      <div className="setup-perm">
        <div className="setup-perm-head">
          <span className="perm-icon">
            <Speaker size={16} />
          </span>
          <span className="perm-label">
            System audio<em>disabled</em>
          </span>
        </div>
        <small className="setup-note">
          System audio is turned off (<code>IRIS_SYSTEM_AUDIO=0</code>). Listen-only mode will hear the room through
          your microphone only, and nothing can capture what your machine plays.
        </small>
      </div>
    );
  }

  const copy = state.status === "done" ? describeSelfTestVerdict(state.verdict) : null;

  return (
    <div className="setup-perm">
      <div className="setup-perm-head">
        <span className="perm-icon">
          <Speaker size={16} />
        </span>
        <span className="perm-label">
          System audio<em>listen-only mode</em>
        </span>
        <button className="setup-btn ghost" onClick={run} disabled={state.status === "running"}>
          {state.status === "running" ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
          {state.status === "running" ? "Testing…" : "Test"}
        </button>
      </div>
      <small className="setup-note">
        {SYSTEM_AUDIO_CAPTURE_DISCLOSURE} macOS has no readable state for this, so there is nothing to grant here —
        the only way to find out whether Iris will hear your machine is to try it. {SELF_TEST_DISCLOSURE}
      </small>
      {copy ? (
        <>
          <p className={`setup-result ${copy.ok ? "ok" : "err"}`}>{copy.headline}</p>
          <small className="setup-note">{copy.detail}</small>
          {copy.offersSettingsRoute ? <SettingsRoute location={location} /> : null}
        </>
      ) : null}
    </div>
  );
}
