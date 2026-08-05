## Context

See `proposal.md — Why`. What this builds on:

- **`vault-write-path` landed.** `electron/vault-write.mjs` owns writing to the
  vault, `appendSpoolRecordSync`/`appendSpoolRecord` exist, `spoolFileFor` gives a
  one-file-per-day name, and the living spec already declares the spool not-a-user-note
  with the exclusion rooted at `inbox/`. A `inbox/sessions/` spool therefore needs no
  new exclusion.
- **The utterance ring already exists in main.** `renderer-bridge.mjs` retains
  `{ text, at }` entries, bounded by count and age, and `run-context.mjs` bounds them
  again more tightly at the point of use. The material this change persists is
  material main already holds.
- **Sibling preferences live in renderer `localStorage`** — sounds, hand control,
  camera device, mic device, and WebGL quality are all read and written in
  `src/App.tsx`. There is no main-process preference store for this class of setting.
- **`untrusted-text.mjs`** already fences the transcript on its way into a run,
  precisely because the microphone does not distinguish who is speaking.

## Goals / Non-Goals

**Goals:**

- The gate fails closed. No arrangement of a failed IPC, a stale renderer, or a
  crash mid-launch results in retention the user did not enable.
- No new recording path: only what the ring already holds, only to a local file.
- Idempotent progressive flushing, so neither a crash nor repeated flushes corrupt
  the record.

**Non-Goals (design-level):**

- **Speaker identification.** Out of scope and would require capabilities Iris does
  not have. The spool is explicitly a room transcript.
- **Encrypting the spool at rest.** It sits in a folder the user chose to have, next
  to their notes, on a machine with its own disk encryption. Encrypting one file in
  a plain-markdown vault would break the "open it in Obsidian" property that is the
  vault's whole premise, for a threat model that a filesystem-level control already
  covers better.
- **Retroactive capture.** Enabling the preference mid-conversation SHALL not sweep
  up what was said before it was enabled, even though the ring still holds it. The
  ring is memory the user did not consent to have written down.
- **Changing the ring's bounds**, or adding a second in-memory buffer.

## Decisions

### D1 — Main is the authority on the gate, and it fails closed

The toggle lives in renderer `localStorage` with its siblings (D2), but the
**decision to retain is made in main**, which holds its own enabled flag,
initialized to **off on every launch** and flipped only by an explicit message from
the renderer carrying the persisted preference.

This is the load-bearing decision. A privacy gate whose only copy lives in the
renderer and is mirrored to main would keep retaining if the mirror ever failed —
the failure mode of a dropped "it's off" message must be *not recording*, never
*recording*. Defaulting off each launch makes the window between process start and
the renderer's first message fail-closed by construction rather than by a handler
that has to run.

Persistence still holds: the renderer reads `localStorage` at boot and tells main,
so a user who enabled it last week has it enabled again.

### D2 — The toggle stays with its siblings, in `localStorage`

Consistency of the interface matters more than moving one preference to a different
store, and D1 already removes the reason to distrust the renderer as the *place the
user's choice is recorded* — it is no longer the thing that authorizes retention,
only the thing that remembers the answer.

**Alternative considered: move it to a main-owned config file.** Rejected as scope
that would either leave one preference stored unlike all five of its siblings, or
turn this change into a preference-storage migration. Neither is what this change is
about.

### D3 — `IRIS_AMBIENT_CAPTURE=off` can only tighten

An env var that force-disables and hides the toggle, for a machine where this must
not be available. There SHALL be no env var that force-*enables* it: a variable that
turns on microphone retention without anyone touching the interface is a worse
capability than the feature itself, and an admin who wants recording can ask the
user to enable it.

### D4 — A watermark on utterance timestamps, not a diff of file contents

`electron/session-capture.mjs` holds the last-flushed timestamp and writes only ring
entries newer than it. Pure and injectable, so its idempotence is asserted directly
rather than inferred from a filesystem.

**Alternative considered: read the spool back and skip what is present.** Rejected —
it turns every flush into a read of an ever-growing file, and it would deduplicate
by text, so a user who genuinely repeated themselves would have the repetition
silently dropped.

The watermark is per-session, not persisted. On relaunch a new session starts and
the ring is empty, so there is nothing a stale watermark could protect against and
nothing it could wrongly suppress.

### D5 — Flush triggers: a timer, sleep, and quit — plus sleep flushing rather than dropping

Progressive flushing on a modest interval, plus a flush when Iris sleeps and when
the app quits (the app already has a quit-time flush path for the canvas scene, so
the shutdown seam exists). Sleep **flushes** what accumulated rather than discarding
it: retention stops at sleep, but what was already said while awake was already
retained under the consent the user gave.

Never on every utterance: that would write to disk in the middle of the audio path
for no benefit, and the interval bounds crash loss to a few seconds of conversation.

### D6 — The spool is written as a self-describing room transcript

Each session's block carries a header naming it a verbatim microphone transcript and
the session's time span, and entries are written as quoted lines rather than as prose.
Two reasons: a user opening the file must not mistake it for notes they wrote, and
the curator must be able to weave a room transcript on different terms than a
deliberate capture — which the living spec now requires the spool's kinds to be
distinguishable enough to allow.

Downstream it is untrusted on exactly the terms `run-context.mjs` already fences the
transcript with. The text may be another person, a video, or a mishearing.

### D7 — The indicator is a requirement, not polish

It is specified as behavior because the alternative — a preference enabled once,
then an indefinite unindicated microphone log — is the failure that makes the
feature indefensible regardless of how well the rest works. It is shown whenever
retention is live (enabled **and** awake) and carries the stop affordance, so
stopping does not require finding a settings panel.

### D8 — The curator's scope widens; nothing becomes automatic

`capture_learning`'s clause names the session spool, and `inboxBacklog` counts it —
which is already possible without change, since `vault-write-path` left
`inboxBacklog` accepting several directories.

Synthesis stays deliberate. A conversation ending is exactly when an automatic
synthesis would feel natural and would be wrong: it would spend the user's money and
rewrite their vault because they stopped talking.

## Risks / Trade-offs

- **A private conversation, possibly including people who did not consent, on disk**
  → Default off; the consent point states that other people's speech may be
  retained; indicated whenever live; stoppable from the indicator; plain markdown the
  user can prune; never transmitted. This is the risk the change exists to manage,
  not one it can eliminate — retention is the feature. Which is why it ships alone,
  reviewed on its own.
- **The gate is mirrored across a process boundary** → D1 makes main default-deny, so
  every failure of the mirror resolves to not recording.
- **Enabling mid-conversation sweeps up prior speech from the ring** → Explicitly a
  non-goal; the watermark is initialized to the enable moment, not to zero.
- **The spool grows much faster than the other two** → One file per day, plain
  markdown, prunable, and excluded from the graph so its volume costs nothing
  visually. If it needs a cap later, the spool contract is the place for it.
- **A curated page built from a mishearing** → The spool is self-describing (D6) and
  fenced downstream, so the curator sees room transcript rather than assertion. It
  cannot be fully prevented: a confident mishearing is indistinguishable from speech.
- **Users enable it, forget, and are surprised later** → D7's always-visible
  indicator is the mitigation, and it is why it is a requirement rather than a nice
  touch.

## Migration Plan

None. Default off means an existing install behaves identically until someone opts
in. Rollback removes the preference and the flush; any session spool already written
stays as plain markdown in the vault, readable and deletable by hand — and remains
excluded from the graph by the exclusion `vault-write-path` already shipped.
