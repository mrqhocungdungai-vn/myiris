## Purpose

Confines the renderer to code and content the app itself ships, and confines the privileged window (the one carrying the `window.iris` IPC bridge) to the app's own origin. The renderer is not a neutral sandbox — it holds a bridge that can approve a parked brief and write user configuration — so a remote script, a navigated-away document, or foreign content granted microphone/camera access would each hand that reach to something outside the app's control.

## Requirements

### Requirement: The renderer executes only code shipped inside the app

Every script and WebAssembly module the renderer executes SHALL be served from the application itself. No script, module, or WASM glue file SHALL be fetched from a third-party origin at runtime.

This matters because the renderer is not a neutral sandbox: it holds the IPC bridge that can approve a parked brief and write user configuration. Code arriving from a network origin therefore runs with reach into privileged main-process operations, and its integrity is outside the app's control.

#### Scenario: Model runtimes load offline
- **WHEN** the app runs with no network access and the user arms wake-word detection and gesture control
- **THEN** both initialize successfully from locally shipped assets

#### Scenario: No third-party script origin remains in renderer source
- **WHEN** the renderer's asset configuration is inspected
- **THEN** no runtime script, module, or WASM path points at an external origin

#### Scenario: Packaged builds ship the runtimes
- **WHEN** the app is packaged for distribution
- **THEN** the vendored runtime assets are present in the packaged application and resolve at the same paths they do in development

### Requirement: A Content-Security-Policy enforces the shipped-code rule

The renderer SHALL be governed by a Content-Security-Policy that denies script and WASM execution from origins other than the application itself. The policy SHALL be enforced by the app rather than relying only on source discipline, so a future asset reference to a remote origin fails visibly instead of silently widening the trust boundary.

#### Scenario: Remote script is blocked
- **WHEN** the renderer attempts to load a script from an external origin
- **THEN** the load is blocked by the policy

#### Scenario: The app's own code runs normally
- **WHEN** the app starts in development and in a packaged build
- **THEN** the UI, audio pipeline, wake word, and gesture control all function with the policy in force

#### Scenario: Network access for model inference is unaffected
- **WHEN** the voice session connects to its live endpoint
- **THEN** the policy permits that connection, which is data, not executable code

### Requirement: The privileged window cannot be navigated away from the app

The window carrying the IPC preload SHALL NOT navigate to any origin other than the application's own. Navigation attempts to any other origin SHALL be cancelled, regardless of how they were initiated — a link, a script, a dropped file, or a dropped URL.

This is what makes the preload bridge safe to expose at all. `window.iris` reaches the user's configuration, the review-approval path, and the prerequisite installer; a document loaded from elsewhere in that same window inherits all of it. A Content-Security-Policy does not cover this case, because navigating the window replaces the document — and with it the policy.

#### Scenario: A dropped file does not navigate the window
- **WHEN** a file or URL is dragged onto the application window
- **THEN** the window does not navigate to it and the running app is unaffected

#### Scenario: Scripted navigation to a remote origin is refused
- **WHEN** code in the renderer attempts to navigate the window to an external origin
- **THEN** the navigation is cancelled and the app document stays loaded

#### Scenario: In-app navigation still works
- **WHEN** the app loads its own document in development and in a packaged build
- **THEN** navigation to the app's own origin proceeds normally

### Requirement: External links open outside the app, never in an app window

A request to open a new window or an external link SHALL be denied as an in-app window and handed to the operating system's default browser instead. No application window SHALL ever host third-party web content.

#### Scenario: An external link opens in the system browser
- **WHEN** the user activates one of the panel's external links
- **THEN** the link opens in the default browser and no new application window is created

#### Scenario: A scripted window open is denied
- **WHEN** renderer code calls for a new window to an external origin
- **THEN** no application window is created for it

### Requirement: Device permissions are granted only to the app's own content

Microphone and camera permission SHALL be granted only to the application's own content, identified by the requesting content's origin, and SHALL be denied otherwise. The permission decision SHALL NOT ignore which content is asking.

#### Scenario: The app's own content keeps microphone and camera
- **WHEN** the app's own document requests microphone or camera access
- **THEN** the request is granted exactly as before this change

#### Scenario: Foreign content is refused the microphone
- **WHEN** content that is not the app's own document requests microphone or camera access
- **THEN** the request is denied
