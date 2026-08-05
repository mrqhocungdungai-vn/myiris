## Context

Iris has removed several controls over the last month — the Hermes worker UI, the
prerequisite installer, a wake prompt — and in each case the component went and
its stylesheet rules stayed. Nothing catches this: an unmatched CSS rule is valid
CSS, so `tsc`, `vite`, `oxlint`, and vitest all stay green. The only signal is a
human reading `claude.css` and wondering whether `.agent-install` is still live.

The just-completed spec sync removed the *claims* that these controls exist. This
change removes the *styling* that implies it, and adds the check that keeps the
two in step.

**Scope correction, found during apply:** the proposal originally named three
dead rules — `.agent-install`, `.hermes`, `.wake-prompt`. Only `.agent-install`
is actually in `claude.css`. `.hermes` (`.status-dot.hermes.on/.warn`) and
`.wake-prompt` are real, and really dead, but they live in `deck.css` — one of
the adopted upstream sheets this same design's Non-Goals puts out of scope.
Sweeping them would violate the "upstream sheets stay byte-comparable" invariant
this change itself is not the place to relitigate. This change is narrowed to
`.agent-install`; the `deck.css` residue is left as a known, separately-owned
gap (see Risks/Trade-offs).

## Goals / Non-Goals

**Goals**

- `claude.css` styles only controls the renderer mounts.
- The invariant is machine-checked, so the next removal cannot leave residue.

**Non-Goals**

- Auditing the other stylesheets (`tokens.css`, the adopted upstream sheets).
  `deepspace-skin` deliberately requires the upstream sheets stay unmodified so
  future ports diff cleanly, and a dead-rule sweep over them would violate that.
  This change is scoped to `claude.css`, the sheet Iris owns outright.
- Deleting unused CSS *custom properties* or token definitions. A token is
  declared centrally and consumed by name; "unused" is a different and much
  weaker signal there.
- Any restyling. No live rule's declarations change.

## Decisions

### D1 — Detection is "no reference in `src/` outside the stylesheet", not coverage at runtime

The reliable check available here is static: a class in `claude.css` with no
occurrence anywhere in `src/**/*.{ts,tsx}` is unreachable. A runtime approach
(rendering every surface and diffing matched rules) would need the whole app
booted, which `test-harness` explicitly forbids tests from requiring.

### D2 — Dynamic class construction is checked before trusting the result, not assumed away

A class assembled as `` className={`thing-${x}`} `` would look dead to a substring
scan. The renderer's dynamic class names were enumerated and inspected for this
change (`deck`, `deck-body`, `boot-line`, `project-bar`, `hud-mode`, and the
`classList.toggle` call in `App.tsx`); none constructs `agent-install`. The check
must keep doing this — reporting a candidate rather than deleting one — because a
scanner that auto-deletes on a substring miss will eventually remove a live style.

So the check **fails with the candidate named** and a human confirms. That is
slower than an autofix and is the point: the cost of a false positive here is a
visibly broken UI that no test would catch.

### D3 — The check fails closed, like the other gates

`workflow-quality-gates` establishes that a gate which cannot run fails rather
than skipping silently, and that `gitleaks` missing is an error. A dead-CSS check
that warned would be ignored within a week — `.hermes` is the evidence, having
survived in plain sight through two renames.

### D4 — Scoped to a check, not to a fifth gate

A separate change adds a spec-drift gate to the four-gate chain. This one does not
introduce a new top-level gate: the check belongs with the existing lint step,
which is already the whole-tree zero-warning pass. Two changes each adding a gate
would collide on `workflow-quality-gates`.

## Risks / Trade-offs

- **A false positive breaks a visible style.** Mitigated by D2: the check names
  candidates and never deletes. Accepted residual risk is a nuisance failure on a
  legitimately dynamic class, resolved by an explicit allowance with a comment
  saying why.
- **The check adds a scan to every lint run.** One stylesheet, 52 classes; the cost
  is negligible against `oxlint` over the whole tree.
- **It only covers `claude.css`.** Deliberate, per Non-Goals — the upstream sheets
  are required to stay byte-comparable to upstream.
- **`.hermes` and `.wake-prompt` stay dead in `deck.css`, uncleaned.** Found
  during apply (see Context). Sweeping an upstream sheet for dead rules is a
  different, unmade decision about that byte-comparability invariant, not a
  natural extension of this change. Left as a known gap for whoever revisits
  that invariant.

## Migration Plan

None. Deleting a rule that matches no element cannot change rendering, and there
is no stored state, config, or persisted format involved.
