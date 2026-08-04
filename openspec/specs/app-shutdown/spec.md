# app-shutdown

## Purpose
The app blocks quit until every live transport (the Gemini Live socket, one-shot runs, and resident sessions) is torn downine after which it force-exits; the teardown runs at most once even if the quit signal fires again.

## Requirements

### Requirement: Quit blocks until teardown completes or a deadline elapses

When the app is asked to quit while any live transport is resident — the Gemini Live socket, one or more stateless-run subprocesses, or one or more resident stateful sessions — the app SHALL NOT exit until those transports have been torn down, or a bounded deadline has elapsed, whichever comes first.

On the first quit signal the app SHALL prevent the default immediate exit, then run a teardown that: closes the Gemini Live session, terminates every live stateless-run subprocess (reaching its whole process group so descendant tool subprocesses are not orphaned — see the run queue's stopping requirement), and closes every resident stateful session (awaiting each session's asynchronous teardown). The whole teardown SHALL be raced against a hard deadline configured by an explicit environment budget (`IRIS_SHUTDOWN_DEADLINE_MS`) with a documented default, consistent with the other explicit budgets in the system. When the teardown settles, or the deadline elapses first, the app SHALL force-exit.

The deadline exists so a transport that refuses to tear down can never wedge the quit; teardown finishing early SHALL exit immediately rather than waiting out the deadline.

#### Scenario: Clean teardown within the deadline

- **WHEN** the app is quit with a live Gemini session, a running stateless-run subprocess, and a resident stateful session, and all tear down before the deadline
- **THEN** the immediate exit is prevented, the Gemini session is closed, the stateless run's subprocess group is terminated, the stateful session teardown is awaited, and the app exits as soon as the teardown settles — leaving no orphaned Claude process

#### Scenario: A transport that will not tear down does not wedge the quit

- **WHEN** the app is quit and a transport's teardown has not completed by the time `IRIS_SHUTDOWN_DEADLINE_MS` elapses
- **THEN** the app force-exits anyway once the deadline is reached, rather than hanging indefinitely on the stuck teardown

### Requirement: Shutdown teardown runs at most once

The teardown SHALL run at most once per quit. If the quit signal is delivered again while a teardown is already in progress (for example because preventing the default caused the platform to re-emit it), the app SHALL NOT start a second teardown.

#### Scenario: A re-entrant quit signal is ignored

- **WHEN** the quit signal fires a second time while the first teardown is still running
- **THEN** the second signal starts no new teardown and does not disturb the one in progress
