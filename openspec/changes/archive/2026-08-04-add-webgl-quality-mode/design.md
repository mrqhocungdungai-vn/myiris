## Context

See proposal.md — Why, for the cost analysis and its origin in commit `bc32c3f`.

Four properties of the current code constrain the approach:

1. **`dpr`, `antialias` and `powerPreference` are frozen at context creation.** They
   are not per-frame state; a running WebGL context cannot be re-asked for them. Any
   design that changes them at runtime must recreate the context.
2. **The orb has two mount sites** — `CenterStage` on the deck and `HudShell` in the
   overlay — with an identical prop list. Anything threaded to the orb must be
   threaded twice, and the two must not drift.
3. **Three surfaces, three different rendering stacks.** The orb and the backdrop are
   React Three Fiber `<Canvas>` elements the app declares. The galaxy is not: it is a
   `3d-force-graph` instance that owns its own renderer and composer, and the app
   only reaches in to `addPass`. There is no single place to configure all three.
4. **`ORB_ACCENT` is already duplicated.** `CenterStage.tsx:8` and `HudShell.tsx:30`
   each hold their own hand-written copy of the per-state accent color, and the
   upstream project exports a single one. The light path's glow needs that color, so
   this change either inherits the duplication or ends it.

## Goals / Non-Goals

**Goals:**

- One derivation of what each surface's settings are, so a fourth WebGL surface added
  later has an obvious place to ask.
- The derivation is a pure function, unit-testable with no DOM, no WebGL and no React.
- The light path is the code path that runs when nothing is configured, so the
  cheapest behavior is also the least conditional one.

**Non-Goals:**

- Optimizing the orb's geometry. It is ~9 meshes; the cost is passes and pixels, and
  changing the silhouette would alter the app's identity for no measurable gain.
- Removing `three` or the R3F packages. The high-fidelity path needs them and the
  galaxy's force-graph rendering needs `three` on both paths, so no dependency leaves.
- A frame-rate governor, an auto-detected quality tier, or a per-surface override.
  Each was considered and rejected as a second mechanism to explain and test.
- Changing any render-loop pausing rule. Those belong to the surfaces' own
  capabilities and this change deliberately leaves them alone.

## Decisions

### D1 — A pure settings module in `src/lib/`, not a React context

Add a module exporting the preference's storage contract (read, persist, default) and
a derivation from the preference to each surface's concrete settings — the orb's
`gl` options and `dpr`, whether the backdrop mounts, whether the galaxy adds its pass.

*Why over a React context:* the app threads every other preference (`handControl`,
`cameraDeviceId`, `soundsEnabled`) as props from `App.tsx` state, and introducing a
context for the fifth one would make this preference the odd one out while adding a
provider to reason about. Props also make the two orb mount sites' prop lists visibly
parallel, which is how the drift in point 2 gets caught in review.

*Why a module rather than inline ternaries at each call site:* three surfaces × four
settings is twelve conditionals scattered across four files, which is exactly the
shape CLAUDE.md names as the mechanism that produced the silently-dropped
`appendSystemPrompt`. A pure function is also the only version of this that gets a
unit test, since none of the three surfaces can be instantiated in vitest.

### D2 — Remount by `key`, not by conditional rendering

Give the orb's `<Canvas>` a `key` derived from the preference. React unmounts the old
element and mounts a new one, disposing the old WebGL context and creating a fresh one
with the new `gl` options — which is the only way to satisfy point 1.

*Why over unmounting the whole orb component:* the expressive state that must survive
(per the spec's "does not disturb the session" scenario) lives in refs above the
`<Canvas>` — the ripple queue, the level refs, the rotation/scale refs are all owned
by `ReactorCore` or by `App`. Keying only the `<Canvas>` keeps those alive and lets
the new context pick them up on its first frame.

*Why not offer a relaunch prompt instead:* the panel already has a reconnect prompt
for settings that need one, and reaching for it here would train the user that display
settings are heavyweight. Nothing about a preference that touches no session state
justifies it.

### D3 — The light path's glow is a CSS layer, and `ORB_ACCENT` is unified first

Draw the glow as a radial-gradient layer behind the orb canvas inside `.orb-stage`,
tinted by the state accent and varying with the orb's energy. The compositor draws it;
it costs no per-frame GPU work in the sense the preference is trying to eliminate.

This requires the accent color, which is currently duplicated in two components. Rather
than add a third copy, export one `ORB_ACCENT` (as the upstream project does) and have
both mount sites read it. That is a small refactor riding along with this change, and
it is justified here rather than deferred because the alternative is knowingly writing
the third copy.

*Alternative considered:* additive sprite meshes inside the scene, which would track
each ring's position rather than sitting behind the whole orb. Rejected — it adds
draw calls and fill-rate to the path whose entire purpose is to remove them, and
`.orb-ring` / `.orb-radar` already establish the CSS-glow idiom this fits into.

*Accepted limitation:* a CSS layer cannot follow the 3D geometry, so the light orb's
glow is a halo behind the orb rather than light emitted by the rings. This is the
visible difference between the two paths, and it is the intended one.

### D4 — Clamp the orb's device pixel ratio to 1.5

Rather than 1 (a quarter of the pixels) or `min(dpr, 2)` (which changes nothing on the
Retina displays this targets).

*Why 1.5:* the orb's thin torus rims and wireframe sphere alias badly at 1.0 once
antialiasing is off, with nothing left to hide it; 1.5 keeps them legible while
cutting the pixel count to about 44% of native. The CSS halo softens what aliasing
remains. `min(dpr, 2)` was rejected outright — on a Retina display `devicePixelRatio`
is already 2, so it saves nothing except on the rare 3× display.

### D5 — The galaxy is configured at pass-add time, not by recreating it

`addBloom` is called once when the galaxy initializes and it is the only place the
galaxy's cost responds to the preference. Read the preference there and skip the call.

*Consequence, accepted:* the galaxy does not respond to a preference change while it
is already open — it picks up the new path the next time it is opened. Recreating a
live force-graph would lose settled node positions, which the galaxy's own capability
requires be preserved across pause/resume. The spec's immediacy requirement is written
against "the WebGL surfaces re-render on the newly chosen path", and the orb and
backdrop do so immediately; documenting the galaxy's deferral here is deliberate
rather than an omission.

### D6 — Storage follows the existing preference pattern verbatim

An `iris.*` key holding `"on"` / `"off"`, read with a lazy `useState` initializer in
`App.tsx` and written in the toggle, exactly as the four existing preferences do.
Absent or unparseable ⇒ light path, which is what makes D1's "cheapest path is the
default path" property hold without a migration step.

## Risks / Trade-offs

- **The light path becomes the only path anyone tests, and the high-fidelity path rots**
  → the settings derivation is unit-tested for both paths, and the manual verification
  task exercises both explicitly.
- **A user on a strong machine never finds the setting and thinks Iris got uglier** →
  the spec requires the control state the trade-off in the panel. Accepted risk: there
  is no in-app prompt on first run, deliberately, since an unprompted-for modal is a
  worse first impression than a slightly plainer orb.
- **`min(dpr, 1.5)` on a non-Retina display renders *above* native** → clamp with
  `Math.min(devicePixelRatio, 1.5)`, never a bare 1.5.
- **Keying the `<Canvas>` drops expressive state after all** → the remount path is
  covered by a manual verification step that toggles while Iris is mid-speech, since
  no automated test can instantiate WebGL here.
- **Unifying `ORB_ACCENT` (D3) touches two components this change otherwise only
  threads a prop through** → it is a pure extraction of two identical literals, and
  the typecheck gate catches any divergence between them at the point of extraction.
- **`main-thread-budget` reads as forbidding any orb visual change** → its requirement
  is scoped to the no-per-frame-allocation refactor ("The rendered result … SHALL be
  identical to before" constrains *that* optimization from changing appearance). This
  change alters appearance deliberately and by user choice, and does not reintroduce
  per-frame allocation on either path. No delta is proposed for it; if a reviewer reads
  that requirement as an absolute invariant, it needs one.

## Migration Plan

No data or config migration: an installation with no stored preference reads as the
light path, which is the intended upgrade behavior rather than something to migrate.

Rollback is a straight revert. The stored preference key is then simply unread and
harmless, so a revert followed by a re-apply restores the user's choice rather than
losing it.
