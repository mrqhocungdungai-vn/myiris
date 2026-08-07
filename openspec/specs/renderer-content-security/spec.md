## Purpose

Confines the renderer to code and content the app itself ships, and confines the privileged window (the one carrying the `window.iris` IPC bridge) to the app's own origin. The renderer is not a neutral sandbox — it holds a bridge that can approve a parked brief and write user configuration — so a remote script, a navigated-away document, or foreign content granted microphone/camera access would each hand that reach to something outside the app's control.
## Requirements
### Requirement: The renderer executes only code shipped inside the app

Every script and WebAssembly module the renderer executes SHALL be served from the application itself. No script, module, or WASM glue file SHALL be fetched from a third-party origin at runtime.

This matters because the renderer is not a neutral sandbox: it holds the IPC bridge that can approve a parked brief and write user configuration. Code arriving from a network origin therefore runs with reach into privileged main-process operations, and its integrity is outside the app's control.

A path handed to a **vendored third-party runtime** SHALL be an **absolute URL, resolved against the document's base URL**, not a relative path passed through as-is. A relative path is ambiguous at the point of use: a runtime that loads its glue through a dynamic `import()` resolves it against the importing module's URL, which the bundler places in a different directory from the document, while a runtime that loads its glue through a script element resolves it against the document. The same string therefore means two different locations depending on a detail of a third-party runtime's internals that is not visible at the call site. Resolving against the document before handing the path over removes that ambiguity for every runtime, including ones added later whose loading mechanism nobody has inspected.

This rule binds paths handed to a third-party runtime. It does not bind the app's own assets loaded by an API whose resolution base is already the document — a `fetch()` of a model file, or the app's own AudioWorklet module. Where such a path is deliberately left relative, the reason SHALL be recorded next to it, so that the exception is legible as a decision rather than as an instance of the defect this rule exists to prevent.

Path resolution SHALL NOT depend on whether the app is running from a development server or a packaged build. A resolution rule that branches on the environment leaves one branch exercised only by one kind of run, so verifying in either environment does not cover the other. A runtime fallback that is attempted in both environments is not such a branch.

#### Scenario: Model runtimes load offline
- **WHEN** the app runs with no network access and the user arms wake-word detection and gesture control
- **THEN** both initialize successfully from locally shipped assets

#### Scenario: No third-party script origin remains in renderer source
- **WHEN** the renderer's asset configuration is inspected
- **THEN** no runtime script, module, or WASM path points at an external origin

#### Scenario: Packaged builds ship the runtimes
- **WHEN** the app is packaged for distribution
- **THEN** the vendored runtime assets are present in the packaged application and resolve at the same paths they do in development

#### Scenario: Vendored runtimes initialize in a packaged build
- **WHEN** a packaged build arms a feature backed by a vendored runtime
- **THEN** that runtime initializes successfully — the assets being present in the package is not sufficient, because a path that resolves to a location the assets were not copied to fails while every file is shipped

#### Scenario: A vendored runtime path is unambiguous at the point of use
- **WHEN** a vendored third-party runtime is given the location of its glue or binary assets
- **THEN** it receives an absolute URL resolved against the document's base URL, so the location does not depend on which directory the bundler emitted the calling module into

#### Scenario: The rule holds for every vendored runtime, not only the one that broke
- **WHEN** the renderer source is searched for paths handed to a vendored third-party runtime
- **THEN** every one of them is pre-resolved, including runtimes whose loading mechanism happens to make a relative path work today

#### Scenario: A deliberately relative path carries its reason
- **WHEN** an asset path is left relative because the consuming API already resolves against the document
- **THEN** that reason is recorded at the call site, so a later reader can tell a decision from an oversight

#### Scenario: One resolution rule covers development and packaged builds
- **WHEN** the path for a vendored runtime asset is computed
- **THEN** the same rule produces it in development and in a packaged build, with no environment-conditional branch that only one kind of run exercises

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

Microphone, camera, and system-audio capture permission SHALL be granted only to the application's own content, identified by the requesting content's origin, and SHALL be denied otherwise. The permission decision SHALL NOT ignore which content is asking.

The origin rule for system-audio capture SHALL resolve identically in development and packaged builds, on the same terms the app's other origin checks already hold — a capture that works from a dev server and is refused from a `file://` document would leave the feature broken only where it ships.

System-audio capture SHALL be granted more narrowly still. It SHALL be granted for audio only, never for screen or window video, and SHALL require the system-audio configuration to be enabled AND one of two further conditions to hold — listen-only mode is engaged, or a user-initiated capture self-test is armed. The configuration gate SHALL remain a precondition of both: disabling system audio SHALL leave no reachable capture surface whatsoever, exactly as `listen-only-mode` requires of its escape hatch, so a user who turned this off never triggers a system recording indicator by any route including the self-test. Every condition SHALL be read from where the main process owns it, never from a value the renderer supplies. Every other request SHALL be denied.

The self-test exists because no reported permission state predicts whether this capture works, so the only way to tell a user whether Iris will hear their machine is to try it before the meeting rather than after (see `setup-panel`). It is a second door into the same capture, and it is admitted on the terms that made the original rule worth having rather than as an exception to them.

The self-test SHALL arm exactly one grant. The main process SHALL consume that arming when it grants a request, so a second request before the test is re-armed SHALL be denied. A predicate that stays true for an interval would grant every request made inside it, which is not what "one test" means: a renderer that is faulty or under someone else's control could hold several concurrent captures while every individual grant still looked correct.

The arming SHALL also expire on the main process's own deadline, so an armed grant that is never used does not persist. Re-arming while an arming is already live SHALL NOT extend that deadline.

The main process SHALL arm the self-test itself, SHALL disarm on its own deadline whether or not anything asks it to, and SHALL disarm when the window that armed it goes away. A renderer SHALL NOT be able to keep an arming alive. The grant SHALL be given only to the frame that armed the test, not to any frame that happens to ask while an arming is live.

What is bounded here is the interval in which a grant can be OBTAINED. A stream already handed out is ended by the renderer stopping its tracks, or by the browser engine tearing down the frame that holds it — the main process cannot revoke it. This limit SHALL be stated rather than implied, because a rule that claimed to end an existing capture would be claiming an enforcement that does not exist.

The app SHALL additionally refuse a self-test grant for any request that asks for video, rather than silently answering with audio only, so that "never video" is an observable refusal instead of a coincidence of what was asked for.

#### Scenario: The app's own content keeps microphone and camera
- **WHEN** the app's own document requests microphone or camera access
- **THEN** the request is granted exactly as before this change

#### Scenario: Foreign content is refused the microphone
- **WHEN** content that is not the app's own document requests microphone or camera access
- **THEN** the request is denied

#### Scenario: Foreign content is refused system audio
- **WHEN** content that is not the app's own document requests system-audio capture
- **THEN** the request is denied

#### Scenario: The origin rule holds in a packaged build
- **WHEN** the app's own document requests system-audio capture from a packaged build
- **THEN** it is recognised as the app's own content and granted, exactly as it is in development

#### Scenario: System-audio capture is audio-only
- **WHEN** the app's own document is granted system-audio capture
- **THEN** the granted stream carries audio only, and no screen or window video is requested or provided

#### Scenario: The self-test is audio-only too
- **WHEN** system-audio capture is granted for a running self-test
- **THEN** the granted stream carries audio only, on the same terms as the mode's own capture

#### Scenario: System audio is unreachable outside the mode
- **WHEN** the app's own document requests system-audio capture while listen-only mode is not engaged and no self-test is armed
- **THEN** the request is denied

Note: this scenario's condition is what this change narrowed. It previously
read "while listen-only mode is not engaged" alone, which is no longer the
whole rule — the self-test is a second door, and the denial now requires
neither condition to hold rather than just the mode being off.

#### Scenario: The escape hatch outranks the self-test
- **WHEN** system audio is disabled by configuration and a self-test is armed
- **THEN** the request is denied, because the configuration gate is a precondition of every route to this capture

#### Scenario: The escape hatch outranks the mode
- **WHEN** system audio is disabled by configuration and listen-only mode is engaged
- **THEN** the request is denied, exactly as before this change

#### Scenario: The mode state is read from its owner
- **WHEN** a system-audio capture request is decided
- **THEN** the mode state consulted is the main process's own, not one reported by the renderer

#### Scenario: Every condition is read from its owner
- **WHEN** a system-audio capture request is decided
- **THEN** the configuration, the mode state and the self-test arming consulted are the main process's own, not ones reported by the renderer

#### Scenario: An arming grants once, not for an interval
- **WHEN** a self-test is armed and system-audio capture is requested twice before it is re-armed
- **THEN** the first request is granted and the second is denied

#### Scenario: An unused arming expires
- **WHEN** a self-test is armed and nothing requests capture before the main process's deadline
- **THEN** the arming expires and system-audio capture is unreachable again

#### Scenario: Re-arming does not extend the deadline
- **WHEN** a self-test is armed repeatedly while an arming is already live
- **THEN** the deadline stays the one set by the first arming rather than being pushed out

#### Scenario: A renderer cannot keep an arming alive
- **WHEN** the renderer that armed a self-test goes away, reloads, or simply stops asking
- **THEN** the arming is dropped and system-audio capture is unreachable again

#### Scenario: Only the frame that armed the test is granted
- **WHEN** a frame other than the one that armed the self-test requests system-audio capture while the arming is live
- **THEN** the request is denied

#### Scenario: A self-test request that asks for video is refused
- **WHEN** a self-test request asks for screen or window video
- **THEN** it is refused outright rather than answered with an audio-only stream

#### Scenario: An already-granted stream is ended by its holder, not by main
- **WHEN** a self-test stream has been granted and the arming then expires
- **THEN** no further grant is possible, and the existing stream ends when its holder stops it or when the frame holding it is torn down

