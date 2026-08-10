## MODIFIED Requirements

### Requirement: A lint gate exists and is invocable on its own

The repo SHALL provide a lint check invocable as a single command, independent of
the typecheck gate and the test runner. It SHALL exit non-zero when the check
fails, so it can gate an editing step, a commit, or a future CI step.

The lint check SHALL cover the renderer sources, the Electron main-process modules,
and the build scripts — the same source surface the other gates cover between them.
A directory of first-party source that no gate reads is out of contract.

**The gate carries two checks, and both can fail it.** Alongside the linter, it
SHALL run a dead-rule sweep over the stylesheet Iris authored, reporting a class
that no renderer source references anywhere. They share one gate because they ask
the same question — is this first-party source reachable — over the same tree, and
because a check bound to no editing event protects nothing. A sweep finding SHALL
be reported and SHALL fail the gate; it SHALL NOT delete a rule, because a class
assembled dynamically looks dead to a static scan and the cost of a wrong removal
is a broken surface no test would catch. A class confirmed to be built dynamically
SHALL be exempted by name with a stated reason, never by narrowing the sweep.

The sweep's scope SHALL be the stylesheet this repo authored, not the adopted Deep
Space sheets — `deepspace-skin` is where that scoping is decided, and this
requirement SHALL NOT restate the reason for it.

#### Scenario: Lint passes

- **WHEN** the lint command is run and the source tree is clean
- **THEN** it exits with code 0

#### Scenario: Lint fails

- **WHEN** the lint command is run and at least one finding is reported by either check
- **THEN** it exits non-zero and names the offending file plus what is wrong — the line and rule for a linter finding, the unreferenced class for a sweep finding

#### Scenario: A dead style rule fails the gate without being deleted

- **WHEN** the authored stylesheet carries a class that no renderer source references
- **THEN** the lint command exits non-zero naming that class, and the rule is left in place for a human to confirm

#### Scenario: A dynamically built class is exempted by name

- **WHEN** a class is assembled at runtime rather than written as a literal
- **THEN** it is exempted individually with a recorded reason, and the sweep's scope is unchanged

#### Scenario: Lint is independent of the other gates

- **WHEN** the lint command is run
- **THEN** it completes without invoking the typecheck gate or the test runner, and requires none of the app's runtime prerequisites — no `.env`, no `claude` binary, no network
