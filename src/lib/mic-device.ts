export const SYSTEM_DEFAULT_MIC = "default";

// Pure constraint-building shared by useAudioPipeline (Gemini Live capture) and
// useWakeWord (local wake-word detection). Base constraints are a parameter,
// not hardcoded, because the two consumers' base sets legitimately differ
// (useWakeWord sets autoGainControl: false; useAudioPipeline does not).
export function micConstraints(base: MediaTrackConstraints, deviceId: string): MediaTrackConstraints {
  if (!deviceId || deviceId === SYSTEM_DEFAULT_MIC) return base;
  return { ...base, deviceId: { exact: deviceId } };
}
