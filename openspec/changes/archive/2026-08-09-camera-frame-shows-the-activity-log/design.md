## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The stream already exists and is already collected.** `pushLog(level,
  message, timestamp)` at `src/App.tsx:308` builds `LogLine` records into an
  eighty-entry, newest-first array. Every main-process `{ type: "log" }` event
  routes into it at `App.tsx:1347`, alongside a dozen renderer-side calls.
  Nothing reads the result.
- **Three levels exist, and only three.** `info`, `warn`, `error`. Nothing in
  the codebase emits anything else, and this change adds nothing.
- **The camera frame's corners are taken.** `.cam-status` is top-right,
  `.gesture-chip` bottom-left, and in the HUD `.cam-stamp` is top-left. The
  bottom band is the only free horizontal run.
- **The eye overlays are stacked above.** `.eye-reticle` is `z-index: 3` and
  `.eye-readout-layer` is `z-index: 4`, both `inset: 0`.
- **The readout panel can reach the bottom of the frame.** Its anchor is clamped
  to `[height/2, 1 - height/2]` — at `height: 0.62` that is `[0.31, 0.69]`, so
  with the tracked eye low in frame the panel spans down to the frame's bottom
  edge.
- **`main-thread-budget` governs the renderer.** Its rules are about per-frame
  work; this is not per-frame work, but the frame budget is shared with two
  MediaPipe loops and a WebGL orb regardless.
- **The deck's camera frame is small.** ~256px wide, so ~192px tall. Five lines
  have to fit in that without crowding out the picture.

## Goals / Non-Goals

**Goals**

- The app's own account of what it is doing is visible while the camera is on.
- A production build is quiet; a development build is not.
- The strip's geometry is fixed — nothing above it ever moves.
- The eye overlays are unaffected in every respect.

**Non-Goals**

- New logging of any kind, at any level, from anywhere.
- Any interaction: not clickable, scrollable, dwellable, dismissible.
- Persistence, export, or a scrollback longer than what is drawn.
- A user-facing control over the threshold.

## Decisions

### D1 — Read the store that already exists, rather than building a channel

The one-line version of this change is `const [, setLogs]` becoming
`const [logs, setLogs]`. Everything else is presentation.

The alternative considered and rejected was a dedicated main→renderer channel
for HUD log lines. It would duplicate a stream that already crosses IPC, give
two paths for the same events to diverge, and require every existing emission
point to opt in. The events are already here; the defect is that the renderer
throws them away.

This also disposes of a known wart. `App.tsx:1184` explains that a refused tool
call is surfaced as a banner "because the log list is discarded ... and an
invisible refusal is indistinguishable from Iris quietly doing the work anyway."
The banner stays — a refusal deserves more than a line in a scroll — but the
reasoning behind it stops being true and the comment goes.

### D2 — The threshold is a property of the build, not a setting

`import.meta.env.DEV` is true under `npm run dev` and false in the bundle `npm
start` runs. Development shows `info` and above; production shows `warn` and
above.

Rejected: an env var override. It would be one line, and the argument against it
is not cost. A threshold that can be changed is a preference; a preference wants
persisting; and a persisted one means a production build can be left permanently
verbose by an experiment somebody forgot about — with the failure showing up on
a livestream rather than at a desk. The mode already answers the question
correctly in both directions, and there is no scenario where the answer needs to
differ from the mode. If one appears, that change can argue for it on its own.

Note what this threshold does **not** do: it does not silence anything. Every
line still reaches the store at every level; production draws fewer of them.
The distinction matters because it means the rule is display policy, and display
policy is the kind of thing that belongs in a pure function with tests (D3)
rather than baked into a collection path.

### D3 — The rule lives in a pure module, not in the component

`src/lib/activity-log.ts`, following `eye-hud.ts` and `telemetry-format.ts`:
level ranking, the threshold, and a selector from the store to the drawn lines.

The reason is specific rather than habitual. What a production build **hides**
is the one thing about this feature nobody will notice being wrong: a threshold
off by one level shows a strip that looks entirely plausible while omitting
every warning. There is no visual check for that, so it needs a test, and a test
needs the rule out of the component.

The selector also owns the ordering flip. The store is newest-first because
`pushLog` prepends; the strip reads newest-last, because a log that grows
downward is the only convention anybody has for one.

### D4 — Fixed height, always, with the lines filling from the bottom

The band is five lines tall whether it holds five lines or none, and each line
is truncated rather than wrapped.

Both halves matter. Wrapping makes a long message two lines, which pushes a
line out of the band — so the strip would show four lines sometimes and five
others, for reasons the user cannot see. A height that follows the content moves
the gesture chip directly above it every time a line arrives, which reads as the
UI twitching.

While empty the band is simply invisible space: no background, no border, no
placeholder. The camera image shows through the whole strip regardless — this is
an overlay on a scene, on the same terms the readout panel already holds itself
to.

### D5 — The strip yields to the eye overlays, and the rule is stated here

`z-index: 1`: above the video and its scan wash, and below everything that
tracks something — the hand skeleton (2), the tracking ring (3), the readout
panel (4). Below the hand skeleton too: a strip reporting what the app did has
no business over the feedback for what the user is doing right now.

The panel can and does reach the bottom of the frame when the tracked face is
low, so overlap is not an edge case to be designed away — it is the normal
consequence of a placement rule that `eye-tracking-hud` argues for at length and
that this change has no business re-opening. Stating the stacking from this
side means `eye-tracking-hud` needs no delta and, more importantly, that a
future change to the eye overlays does not have to know this capability exists.

The gesture chip moves up to clear the band. It keeps its corner, its shape and
its behaviour; only its offset changes.

### D6 — Sized in container units, like the readout

`font-size: clamp(...)` against the frame's inline size, on the pattern
`.eye-readout-layer` already establishes.

The container is `.camera-frame` itself rather than the strip's own layer,
because two elements have to agree here: the strip and the gesture chip that
must clear it. Custom properties are substituted at the use site, so declaring
`--cam-log-band` once on the frame gives both of them the same `cqw`-derived
value, and neither can be tuned out of step with the other. The HUD already
declared `container-type` on its own `.camera-frame` for the REC stamp; that
declaration moves to the shared base rule rather than becoming a second copy.

One setting is then right in both surfaces, and the HUD's camera-zoom toggle
rescales the strip live with no re-tuning — which is the same property
`eye-tracking-hud` already asks of the eye overlays, arrived at the same way.

### D7 — React state, not a ref

The eye overlays read refs because they update every frame. Log lines arrive at
human rates, and the store is already React state whose write already re-renders
`App` today — for nothing. Reading it changes no cost and buys the feature.

The honest note: `pushLog` re-renders `App` on every line, and a Claude run can
produce them in bursts. That is pre-existing, it is the same shape as
`transcript`, and making it cheaper is a separate concern from making it
visible. Recorded here so the next person measuring frame time knows it was
seen and not missed.

## Risks / Trade-offs

- **Five lines is a lot of a 192px frame.** ~23% of the deck dock's height. The
  band is the bottom of the picture, where a face rarely is, and the strip is
  translucent — but it is real screen, and if it crowds the preview the count is
  the knob.
- **A burst of log lines scrolls faster than anyone can read.** Accepted: this
  is an ambient indicator that the app is working, not a console. The comms
  column remains where a user actually reads what happened.
- **Production quietness is invisible until it is wrong.** A user who never runs
  a development build has no way to know a level is being hidden. Mitigated by
  D3's tests, which are the only real check on this.
- **The strip and the readout panel can overlap.** By design (D5), and the panel
  wins. It will look like the panel is sitting on top of the log, because it is.

## Open Questions

- Whether five lines is right at the deck dock's size, or whether four reads
  better there. Only the running app with a real burst of lines can say.
- Whether a production build ends up too quiet to be worth the band. If it does,
  the answer is a `debug`/`info` split done properly across the main process —
  a different change, deliberately out of scope here.
