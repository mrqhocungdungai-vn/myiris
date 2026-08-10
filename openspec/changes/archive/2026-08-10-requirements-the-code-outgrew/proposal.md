## Why

Five statements in the living spec are no longer true of the code, and every gate
in the repo reports green: `spec:check` is clean, `openspec validate --specs
--strict` passes 52/52. That is the designed limit of both — the drift gate's own
header says it catches mechanical symptoms, not truth — so the only thing that
finds a requirement the code has quietly outgrown is someone reading the pair.

One of the five is the exact shape that already shipped a user-facing defect.
`setup-panel` still requires the bundled-component rows to carry **copyable
install commands**, and still has the panel explain that the pipeline is off
"because no `claude` binary was found, and shows how to install it". The bundling
migration removed both: there is no host binary to find and no command a user
could run to repair a damaged bundle. `pipeline-availability` says so explicitly
("No bundled-component row SHALL offer an install action, an install command, or
a copyable string presented as a command"), and `setup-panel`'s own later
requirement says it too — so the file contradicts itself, and the half that is
false is the half the renderer once implemented. `PrereqRow` and its "Copy
install command" button are gone from the code; the requirement that asked for
them is not.

The rest are smaller but the same failure: a requirement whose subject no longer
exists reads as a specification of something, and the next change authored
against it inherits the falsehood.

## What Changes

**`setup-panel` stops asking for install commands.** The availability requirement
is restated to defer to `pipeline-availability` for the row vocabulary
(bundled/damaged, one shared re-check) instead of re-declaring it wrongly, and
its chat-only scenario says what the panel actually says: the pipeline is off
because a credential is missing, or because the bundled runtime is damaged and
reinstalling the app is the fix. The availability-flip scenario stops flipping on
"the Claude binary detected for the first time" — availability is the probe **and**
a credential, and the bundled binary is always there, so the flip a user can
cause is the credential one.

**`config-persistence` names the path it actually validates.** The requirement
still holds — an executable is validated before it is spawned — but its subject is
now the bundled binary, not a config-sourced override. The override and the probe
of known install locations were deliberately removed with the bundling migration,
and `pipeline-availability` forbids reintroducing them, so the three scenarios
written against them describe a world that cannot occur. Replaced by the same
guarantee stated over the real sink: a packaging fault (missing `asarUnpack`
target, executable bit lost in a copy) fails with an error naming the cause
instead of a bare `ENOENT` at spawn time.

**`renderer-structure` stops naming a hook that does not exist.** The extraction
scenario lists `useHoldToScroll` under `src/hooks/`. There is no such module and
no such symbol anywhere in the tree — hold-to-scroll is inline in `App.tsx` and in
`ReaderCore.tsx`, and the gesture itself is specified where it belongs, in
`two-hand-gestures`. The scenario keeps the hooks it names truthfully and drops
the one it does not.

**`holo-deck-backdrop` names the layers that exist.** It lists the Deep Space
gradient layers as `hud-nebula`/`hud-glow`/`hud-vignette`; only the first two
exist. The same sentence also requires the backdrop to land "without modifying any
upstream-verbatim Deep Space stylesheet" — a property `deepspace-skin` has since
retired on the record, because three of the six sheets carry Iris rules. The
constraint that still means something is the one `deepspace-skin` now states
(these sheets are Iris's own; the sweep is scoped to `claude.css`), so this
requirement points at it rather than restating a dropped one.

**`workflow-quality-gates` accounts for the whole lint gate.** `runLint()` runs
oxlint *and* the dead-`claude.css` rule sweep, and fails on either. The spec
describes only oxlint, down to "names the offending file, line, and rule" — so a
red `npm run lint` has a cause the living spec does not admit exists. The
requirement is restated to cover both checks and to say why they share one gate:
the sweep asks the same question about the same source surface, and a check bound
to nothing protects nothing.

**No code changes.** Every item is the spec catching up to code that is already
right. Where the two disagreed about behavior, the code's behavior is the one
`pipeline-availability`, `deepspace-skin`, and `two-hand-gestures` already
specify — this change does not decide anything new, it removes text that outranks
nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `setup-panel`: the pipeline-availability panel requirement stops mandating
  copyable install commands and an install-how-to, and its flip scenario is
  restated on the two-condition gate.
- `config-persistence`: the executable-validation requirement is restated over
  the bundled binary; the config-override and install-location-probe scenarios
  are removed.
- `renderer-structure`: the hooks-extracted scenario drops `useHoldToScroll`.
- `holo-deck-backdrop`: the backdrop requirement names the two layers that exist
  and defers to `deepspace-skin` for the stylesheet constraint.
- `workflow-quality-gates`: the lint-gate requirement covers the dead-CSS sweep
  that is bound into it.

## Impact

- Living spec only: `openspec/specs/setup-panel/`,
  `openspec/specs/config-persistence/`, `openspec/specs/renderer-structure/`,
  `openspec/specs/holo-deck-backdrop/`, `openspec/specs/workflow-quality-gates/`.
- **No code, test, script, or doc changes.** The five gates should be identical
  before and after; `spec:check` and `openspec validate --specs --strict` are the
  verification, and both already pass — which is the point being recorded here.
- No migration. Nothing a user has configured changes meaning.
