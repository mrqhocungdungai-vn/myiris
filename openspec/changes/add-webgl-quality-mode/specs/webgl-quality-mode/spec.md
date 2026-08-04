## Purpose

Lets a user decide whether Iris spends their GPU on visual effects, by putting every WebGL surface in the app behind one quality preference that defaults to a light path — so a modest machine runs a usable Iris out of the box, and a capable one can opt back into the full look.

## ADDED Requirements

### Requirement: A single quality preference governs every WebGL surface

The app SHALL expose exactly one user-facing quality preference that governs every WebGL surface it renders — the orb, the deck's particle backdrop, and the second-brain galaxy. The preference SHALL have two states: a **light path** and a **high-fidelity path**. No WebGL surface SHALL define its own independent quality setting, and no surface SHALL be exempt from the preference, so that a user who chooses the light path does not have to discover a second control to stop a second surface from loading their GPU.

The preference SHALL be a per-machine display choice, persisted locally so it survives relaunch. It SHALL NOT be part of the `.env` configuration surface: it is not an `IRIS_*` option, it is not written by the config IPC, and it does not appear in `.env.example`.

#### Scenario: One control covers all three surfaces

- **WHEN** the user sets the preference to the light path
- **THEN** the orb, the deck backdrop, and the galaxy all render on their light path, without the user changing any further setting

#### Scenario: The preference survives relaunch

- **WHEN** the user sets the preference and quits and reopens Iris
- **THEN** the preference is still in the state they left it, and the WebGL surfaces render accordingly from first paint

#### Scenario: Not an environment option

- **WHEN** the effective `.env` is inspected after the user changes the preference
- **THEN** it is unchanged — the preference is not persisted as an environment variable and does not appear in `.env.example`

### Requirement: The light path is the default

The preference SHALL default to the light path on a machine that has never set it, including an existing installation upgrading into this behavior. A user SHALL NOT have to opt out of the effects to get a usable app; they opt *in* to them.

#### Scenario: A fresh install starts light

- **WHEN** Iris starts on a machine with no stored preference
- **THEN** the light path is in effect

#### Scenario: An upgrade starts light

- **WHEN** an existing installation that predates this preference starts
- **THEN** the light path is in effect, and the user's previously-seen high-fidelity rendering is available by turning the preference on

### Requirement: The light path removes post-processing and clamps pixel cost

On the light path, every WebGL surface SHALL render **without any bloom or other full-screen post-processing pass**, and the orb SHALL additionally render with its device pixel ratio clamped below the display's native ratio, without multisample antialiasing, without requesting a high-performance GPU, and with materials that require no scene lighting. On the high-fidelity path, every surface SHALL render exactly as it did before this preference existed.

These are the costs the preference exists to remove: the per-frame blur pyramid, the multiplied pixel count on a high-density display, and — on a machine with both an integrated and a discrete GPU — the request that forces rendering onto the discrete one.

#### Scenario: No post-processing on the light path

- **WHEN** the light path is in effect and any WebGL surface renders
- **THEN** no bloom or other full-screen post-processing pass runs for that surface

#### Scenario: Pixel cost is clamped on the light path

- **WHEN** the light path is in effect on a high-density display
- **THEN** the orb renders at a device pixel ratio below the display's native ratio, and without multisample antialiasing

#### Scenario: The discrete GPU is not forced on the light path

- **WHEN** the light path is in effect on a machine with both an integrated and a discrete GPU
- **THEN** no WebGL surface requests a high-performance GPU

#### Scenario: The high-fidelity path is unchanged

- **WHEN** the high-fidelity path is in effect
- **THEN** every WebGL surface renders with the same passes, pixel ratio, antialiasing and GPU preference it used before this preference existed

### Requirement: Changing the preference applies immediately

Toggling the preference SHALL take effect without relaunching the app. Because a WebGL surface's pixel ratio, antialiasing and GPU preference are fixed when its rendering context is created, the app SHALL recreate the affected surfaces rather than leave them running with the settings of the path the user just left. Recreation SHALL preserve the user's session: the orb SHALL resume in its current expressive state, and any active layer SHALL remain open.

A surface that cannot be recreated without destroying state its own capability requires be preserved SHALL instead adopt the new path the next time it is opened, and SHALL NOT be torn down under the user. This applies to the galaxy, whose settled node positions survive pause and resume by contract; it SHALL NOT apply to the orb or the deck backdrop, which hold no such state and SHALL therefore change immediately.

#### Scenario: The orb and backdrop re-render without a relaunch

- **WHEN** the user changes the preference while Iris is running
- **THEN** the orb and the deck backdrop render on the newly chosen path immediately, with no relaunch and no prompt to relaunch

#### Scenario: Toggling does not disturb the session

- **WHEN** the user changes the preference while Iris is awake and speaking, with a layer open
- **THEN** the conversation continues uninterrupted, the orb resumes in its current expressive state rather than resetting to idle, and the open layer stays open

#### Scenario: An open galaxy adopts the new path on reopen

- **WHEN** the user changes the preference while the galaxy is already open
- **THEN** the open galaxy keeps rendering on the path it was opened with, retaining its settled node positions, and renders on the new path the next time it is opened

### Requirement: The light path is a usable look, not a degraded one

The light path SHALL remain visually coherent rather than reading as a broken version of the high-fidelity path. Where a surface loses its bloom-driven glow, it SHALL either substitute a glow drawn by a means that costs no per-frame GPU work, or retain an equivalent in-scene element that already exists independently of the post-processing pass. No surface SHALL be left visibly unlit or on a bare transparent background on the light path.

#### Scenario: The orb still reads as lit

- **WHEN** the light path is in effect and the orb is in any expressive state
- **THEN** the orb carries a visible glow keyed to that state's color, rather than appearing as flat unlit geometry

#### Scenario: No surface loses its background

- **WHEN** the light path is in effect
- **THEN** the deck still has a visible layered background and the galaxy still has its opaque deep-space backdrop and starfield

### Requirement: Expressive and lifecycle behavior is identical on both paths

The quality preference SHALL change only how surfaces are rendered, never what they express or when they run. On both paths the orb SHALL keep its full expressive repertoire — state palette, thinking swirl, wake pulse, speech-lock ripple, and task flashes — and every surface SHALL keep the render-loop pausing rules defined by its own capability. The preference SHALL NOT be used to skip pausing on the high-fidelity path, nor to pause more aggressively on the light path.

#### Scenario: Expressions work on the light path

- **WHEN** the light path is in effect and Iris wakes, thinks, locks in speech, and completes a task
- **THEN** the wake pulse, thinking swirl, speech-lock ripple and task flash all render, in the state's palette

#### Scenario: Pausing rules are untouched

- **WHEN** either path is in effect and a surface reaches a condition its own capability says pauses its render loop
- **THEN** the loop pauses exactly as that capability specifies, and resumes exactly as it specifies
