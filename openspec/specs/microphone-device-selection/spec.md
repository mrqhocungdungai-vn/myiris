## Purpose

Lets the user pick a specific microphone input device for Iris to capture from, instead of always using the OS default. The selection governs both places Iris opens a microphone stream — Gemini Live conversation capture (`useAudioPipeline`) and local "Hey Iris" wake-word detection (`useWakeWord`) — persists across restarts, applies live via hot-swap to whichever consumer currently holds an open stream, and automatically falls back to System Default if the selected device fails, since a non-functioning microphone breaks the core product rather than being merely optional.
## Requirements
### Requirement: Microphone input device selection and persistence

The app SHALL let the user select which `audioinput` device Iris captures from, via a single selector in the SetupPanel's Permissions section (see `setup-panel` spec) that governs **both** places Iris opens a microphone stream: `useAudioPipeline` (Gemini Live conversation capture) and `useWakeWord` (local "Hey Iris" wake-word detection). The selector SHALL offer a `"System Default"` option plus one entry per enumerated `audioinput` device (via `navigator.mediaDevices.enumerateDevices()`), SHALL remain disabled/hidden with an explanatory hint until the Microphone permission is granted **at the operating-system level**, on the terms of `setup-panel`'s "The Permissions step reports the operating system's answer", and SHALL live-refresh its option list on `navigator.mediaDevices.ondevicechange` while the panel is mounted. The selected device id SHALL persist across app restarts (`localStorage`, independent of the camera's persisted selection). This control SHALL exist only in the Orbital Deck's SetupPanel — it SHALL NOT be exposed in Glass HUD, nor as a Gemini-callable tool.

The gate SHALL NOT be the renderer's own view of the browser engine's permission store. The app grants microphone permission to its own document unconditionally as a security measure, so that store answers with the app's decision rather than the user's — and the selector would populate with blank-labelled devices from a permission the operating system has never granted, which is the state this gate exists to prevent. The requirement's wording is unchanged in shape and changed in meaning: the same selector will now stay hidden in cases where it previously appeared, and those are the cases where Iris could not capture anyway.

#### Scenario: Choosing a specific microphone

- **WHEN** the user selects a specific microphone from the selector
- **THEN** the choice persists across app restarts and the next (or current, per the hot-swap requirement below) capture uses that device

#### Scenario: Microphone selector gated on permission

- **WHEN** the operating system has not granted the Microphone permission
- **THEN** the microphone device selector is disabled or hidden with a hint to grant Microphone permission first, instead of showing devices with blank or meaningless names

#### Scenario: The app's own internal grant does not open the selector

- **WHEN** the app has granted its own document microphone access internally while the operating system has not granted it
- **THEN** the selector stays hidden, because the gate reads the operating system's answer rather than the renderer's

#### Scenario: Device list stays live while Settings is open

- **WHEN** Settings is open, Microphone permission is granted, and an audio input device is connected or disconnected (e.g. plugging in a USB mic)
- **THEN** the selector's option list updates to reflect it without the user closing and reopening the panel

### Requirement: Selecting a device applies immediately to whichever mic consumer is active

When the user picks a device from the selector (or the change arrives via the auto-fallback path below), the capture graph of whichever mic consumer currently holds an open stream — `useAudioPipeline` during an active Gemini Live session, or `useWakeWord` while idle with wake word armed — SHALL be torn down and rebuilt against the newly selected device. Rebuilding `useAudioPipeline`'s capture graph SHALL NOT disturb the underlying Gemini Live session or the output/playback audio path, and SHALL NOT change whether the user is currently muted — the newly acquired stream SHALL have the same mute state applied as the stream it replaces. Only one of the two consumers holds a stream at any given time (`useWakeWord` is disabled precisely while a session is active), so at most one hot-swap happens per selection change.

#### Scenario: Hot-swap while a session is listening

- **WHEN** the user changes the microphone selection while a Gemini Live session is actively listening
- **THEN** the previous capture stream stops, a new one starts on the newly selected device, and the conversation continues without the Live session itself reconnecting

#### Scenario: Hot-swap while wake word is listening

- **WHEN** the user changes the microphone selection while idle with wake word enabled (and thus `useWakeWord` holding an open stream)
- **THEN** the previous wake-word capture stream stops and a new one starts on the newly selected device, with no gap that requires the user to reopen Settings or toggle wake word off and on

#### Scenario: Selection while fully idle applies on next capture

- **WHEN** the user changes the microphone selection while no session is active AND wake word is disabled (so neither consumer holds an open stream)
- **THEN** no capture graph exists to rebuild, and the new selection is used the next time either consumer opens a stream (a session starting, or wake word being turned on)

#### Scenario: Muted state survives a hot-swap

- **WHEN** the user has muted their microphone during an active session and then changes the microphone selection
- **THEN** the newly selected device's capture stream starts already muted — the user does not need to notice and re-mute — and the mute indicator continues to reflect reality throughout the swap

### Requirement: Automatic fallback to System Default on device failure

If the currently selected microphone device (whether just chosen or loaded from a persisted prior selection) fails to open in **either** `useAudioPipeline` or `useWakeWord` — the device was disconnected, no longer exists, or `getUserMedia` rejects with a constraint error such as `OverconstrainedError` or `NotFoundError` — the app SHALL automatically retry capture with no `deviceId` constraint (System Default), update both the persisted selection and the visible selector value to reflect the fallback, and log a warning describing what happened. This SHALL NOT silently continue offering the failed device as the apparent selection, and SHALL NOT leave capture stopped when System Default itself is available.

#### Scenario: Persisted device is missing on next launch

- **WHEN** the app starts with a persisted microphone selection that no longer matches any enumerated device
- **THEN** capture starts on System Default instead, the persisted selection and selector both update to System Default, and a warning is logged explaining the previously selected microphone was unavailable

#### Scenario: Selected device is unplugged during a session

- **WHEN** a specifically selected microphone is physically disconnected while a session is capturing audio from it
- **THEN** capture falls back to System Default automatically, the selector and persisted value update accordingly, and a warning is logged — the session keeps hearing the user via System Default rather than going silent

#### Scenario: Selected device is unplugged while wake word is armed

- **WHEN** a specifically selected microphone is physically disconnected while `useWakeWord` is listening for "Hey Iris" on it
- **THEN** wake-word listening falls back to System Default automatically, the selector and persisted value update accordingly, and a warning is logged — wake-word detection keeps working rather than silently going deaf until the user notices and reopens Settings

#### Scenario: System Default is also unavailable

- **WHEN** the fallback retry against System Default also fails
- **THEN** the failure is logged the same way an AudioWorklet load failure is already logged today, and capture stops (there is no further fallback target)

