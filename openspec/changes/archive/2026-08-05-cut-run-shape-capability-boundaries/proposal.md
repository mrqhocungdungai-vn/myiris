## Why

Three capabilities specify the two run shapes, and they overlap. The spec sync
that renamed `po-live-session` to `stateful-verb-session` deliberately left the
overlap in place — re-cutting boundaries is a design decision, and folding it into
a vocabulary sweep is how scope grows until nothing closes. This change is that
decision, made on its own.

**The overlap is not a matter of taste. One requirement exists twice, verbatim.**

`stateful-verb-session`, "An in-flight stateful turn always settles":

> Cancellation of a stateful turn SHALL go through the same caller-facing path as
> cancellation of a headless run… Where the runtime provides an interrupt for a
> turn already in progress, that SHALL be used rather than tearing down the
> transport, and any queued work that survives the interrupt SHALL be recorded
> rather than reported as cancelled.

`run-execution-queue`, "Both roles cancel through one path":

> Cancellation SHALL work identically for a resident session and a one-shot run,
> from the caller's point of view… Where the runtime provides an interrupt for a
> turn already in progress, Iris SHALL use it rather than tearing down the
> transport, and SHALL record which queued work survived the interrupt so the user
> is not told that something was cancelled when it will still run.

Same rule, same two scenarios (*"Cancellation is lifetime-agnostic"* and the
survivor report), two capabilities. This is the failure the verb registry exists
to prevent, reproduced in the spec tree: two definitions of one rule, free to
drift, with nothing to say which is authoritative when they do.

A second, quieter overlap: `verb-tool-surface` carries *"Verbs that continue one
conversation share one live session"* — session mechanics, in the capability that
defines what a verb *is*. So a reader asking "who owns the resident session?" finds
part of the answer in each of two files.

And `run-execution-queue`'s requirement is still titled **"Both roles cancel
through one path"** — the deleted role concept, surviving in a requirement title
because the vocabulary sweep's criterion matched only uppercase `PO`/`DEV`.

## What Changes

One boundary, stated once and applied:

- **`run-execution-queue` owns the slot and every run's fate** — admission,
  finalization, terminal statuses, cancellation, and bounds, for all run shapes.
- **`stateful-verb-session` owns session mechanics** — how a resident session is
  opened, kept, delivered turns, prompted, and reset.
- **`verb-tool-surface` owns what a verb is** — the registry, per-request choice,
  the declaration of statefulness, capability scoping, the dispatch record.

Concretely:

- **The duplicated cancellation rule is dropped from `stateful-verb-session`**, which
  keeps only what is genuinely session-specific: a turn must settle when its
  session ends. The queue keeps the cancellation contract, since it owns the slot
  the cancellation releases.
- **"Verbs that continue one conversation share one live session" moves** from
  `verb-tool-surface` into `stateful-verb-session`, unchanged in substance.
- **`run-execution-queue`'s cancellation requirement is retitled** away from "roles".

## Capabilities

### Modified Capabilities

- **`stateful-verb-session`** — one MODIFIED requirement (duplicate dropped), one
  ADDED requirement (moved in).
- **`verb-tool-surface`** — one REMOVED requirement (moved out).
- **`run-execution-queue`** — one MODIFIED requirement (retitled, role noun removed).

## Impact

- **Spec only. No code change, and no behavior change.** Every rule that exists today
  still exists after this; each is stated in exactly one place. Both duplicates are
  already implemented by one shared path in `run-queue.mjs`, which is why the
  duplication produced no bug — only the freedom to grow one.
- Cross-references in `docs/PIPELINE_INTERNALS.md` are checked and updated if they
  point at a moved requirement.
- A follow-on overlap is **explicitly not** addressed: `verb-tool-surface`'s "A verb
  sees only the capabilities its work needs" and `stateful-verb-session`'s "The live
  session enables skills explicitly" both touch skill scoping. They are not
  duplicates — one is per-verb policy, the other is how a session loads skills
  regardless of `cwd` — and collapsing them needs its own argument. Recorded here so
  it is a deferral, not a miss.
