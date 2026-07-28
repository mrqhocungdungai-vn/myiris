## MODIFIED Requirements

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
