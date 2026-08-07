## MODIFIED Requirements

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
