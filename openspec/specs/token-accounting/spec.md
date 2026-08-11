# token-accounting Specification

## Purpose

A per-app-session account of what each paid engine reports consuming — the voice
engine and the build engine — kept in **tokens**, because that is the only unit
both of them actually report and the alternative would be the app holding a price
list and multiplying. Two accounts, never combined; every figure from what the
engine itself reported and never estimated from anything else; counted from app
start regardless of whether anything is displaying it. It is a reading for the
user and an input to nothing: no prompt, no verb, no spoken answer, no behavior
anywhere is conditioned on it, and the only mechanism that acts on spend remains
each run's own declared ceilings.

## Requirements
### Requirement: The app counts what each engine reports consuming, in tokens

The app SHALL keep an account of the tokens consumed by each paid model it
calls: the voice engine and the build engine.

Every figure in that account SHALL come from what the engine itself reported.
The app SHALL NOT estimate, extrapolate, or derive a token figure from anything
else — not from audio duration, not from text length, not from a price.

Tokens SHALL be the unit. A monetary figure SHALL NOT be computed for an engine
that does not report one, since that would require the app to hold a price list
and multiply, and a stale price list produces a wrong number that looks exactly
like a right one. Where an engine does report a cost, that figure MAY continue to
be shown wherever it already is; this capability neither replaces nor duplicates
it.

#### Scenario: A voice conversation is counted

- **WHEN** the user holds a voice conversation and the voice engine reports token usage
- **THEN** the app's account of that engine's tokens grows by what the engine reported

#### Scenario: A build run is counted

- **WHEN** a run on the build engine finishes and reports its token usage
- **THEN** the app's account of that engine's tokens grows by what the run reported

#### Scenario: Nothing is invented

- **WHEN** an engine reports no token figure for an exchange
- **THEN** nothing is added to its account, and no figure is estimated from anything else

### Requirement: The two engines are counted separately and never combined

Each engine SHALL have its own account. The app SHALL NOT present, store, or
compute a single combined token figure across engines.

The two are different models at different prices per token, and their volumes are
dominated by different things — continuous audio in one case, file contents in
the other. A combined figure would move for reasons the user cannot attribute
and cannot act on.

#### Scenario: Each engine has its own figure

- **WHEN** both engines have consumed tokens in the same app session
- **THEN** each is reported as its own figure, identified by which engine it belongs to
- **AND** no combined total is reported

### Requirement: Each account reports its running total and the most recent addition

For each engine, the app SHALL make available both the total for the current app
session and what the most recent call added to it.

The total answers "what has this cost me", the most recent addition answers
"what did that just cost me", and neither substitutes for the other: a total
alone hides an expensive single call, and a per-call figure alone hides an
accumulation of cheap ones.

#### Scenario: A call reports both figures

- **WHEN** an engine reports usage for a call
- **THEN** that engine's session total and the amount that call added are both available

#### Scenario: The most recent addition is the most recent one

- **WHEN** a further call is reported for the same engine
- **THEN** the most recent addition reflects the newer call, and the total reflects both

### Requirement: A total never decreases, and no report is counted twice

A reported session total SHALL be monotonically non-decreasing for the lifetime
of the app session.

Where an engine reports a **cumulative** counter, successive reports SHALL NOT be
summed. Where it reports **per-exchange** figures, they SHALL be summed. The app
SHALL be correct under both without being told which it is receiving, because
that property is not guaranteed by the engines' contracts and can change with a
model version.

A counter that restarts — a new connection, a resumed session, a rotated socket
— SHALL NOT reduce the reported total, and SHALL NOT cause the tokens counted
before it to be dropped or re-counted.

A single unit of work SHALL be counted exactly once, even if the app observes its
usage report more than once.

#### Scenario: A cumulative counter is not double-counted

- **WHEN** an engine reports a total that already includes everything it reported before
- **THEN** the account reflects that total rather than the sum of the reports

#### Scenario: A restarted counter does not lose or reset the account

- **WHEN** an engine's connection is replaced mid-session and its counter starts from zero again
- **THEN** the reported total continues from where it was and keeps growing

#### Scenario: One unit of work counts once

- **WHEN** the same completed run's usage is observed twice
- **THEN** it is counted once

### Requirement: Work that ended badly is counted too

A unit of work SHALL be counted regardless of how it terminated. Work that hit a
ceiling, went unanswered, or failed SHALL be counted on the same terms as work
that succeeded.

Tokens spent on a failure were still spent, and those are the cases a user most
wants to see. An account that counts only successes understates precisely where
it matters.

#### Scenario: A failed run still counts

- **WHEN** a run terminates as failed, limited, or unanswered, having reported usage
- **THEN** its tokens are added to that engine's account

### Requirement: Counting is independent of anything displaying it

Counting SHALL begin when the app starts and SHALL NOT depend on any view,
overlay, camera, or window being open.

A count that started when a display opened would under-report every session, and
would do so invisibly — the figure would be self-consistent and wrong.

Delivering the account to a display MAY be limited to when something is
displaying it. When a display begins showing the account, it SHALL immediately
receive the current figures rather than waiting for the next call, so that a
display opened late shows the session so far rather than an apparent fresh start.

The account SHALL cover the current app session and SHALL NOT be persisted
across restarts. A restart begins a new account.

#### Scenario: Consumption before anything was displayed is included

- **WHEN** the user converses with the voice engine with no display of the account open, then opens one
- **THEN** the figures shown include what was consumed before it was opened

#### Scenario: A restart starts a fresh account

- **WHEN** the app is quit and started again
- **THEN** both accounts begin at nothing, and nothing from the previous session is carried in or read from disk

### Requirement: Nothing that has reported nothing reads as zero

An engine that has reported no usage at all in this session SHALL be reported as
absent, not as zero.

Zero is a real value once an engine has reported: it means an exchange consumed
nothing countable. Absence means the engine has not been used, or is not
configured at all — which is the ordinary state of the build engine when no
Claude credential is present. Rendering that as `0` asserts a measurement nobody
took.

#### Scenario: An unused engine is absent

- **WHEN** no Claude credential is configured, so no run has ever executed
- **THEN** the build engine's account reads as absent rather than as zero

#### Scenario: A reported zero is a value

- **WHEN** an engine reports usage whose countable total is zero
- **THEN** that engine's account reads as a figure, not as absent

### Requirement: Cached input is reported as its own figure, never folded into the headline

Where an engine distinguishes tokens read from a cache from tokens processed
fresh, the app SHALL report the cached-read figure separately from the headline
figure for that engine, and SHALL NOT add it into that headline.

Cached reads routinely exceed everything else by an order of magnitude while
costing a fraction per token. Adding them in makes the headline climb far faster
than consumption actually rises — which defeats the reason the account is kept in
tokens rather than in currency: that the figure should track what is really being
consumed.

#### Scenario: The headline excludes cached reads

- **WHEN** a run reports fresh input, output, cache-written and cache-read tokens
- **THEN** the headline figure covers fresh input, output and cache-written tokens
- **AND** the cache-read figure is reported alongside it, as its own value

### Requirement: Nothing in the app acts on the account

The account SHALL NOT reach any prompt, system instruction, tool declaration,
tool parameter, verb, spoken response, note, or session store. No behavior
anywhere in the app SHALL be conditioned on it.

It is a reading for the user, not an input to the system. A model that can see
its own consumption begins reasoning about it — trimming work it was asked to
do, or accounting for itself unprompted. The mechanism that acts on spend already
exists and is enforced in configuration rather than by instruction: the per-run
turn and spend ceilings, and the distinct terminal status a run that hits one
carries.

The account MAY be written to the app's diagnostic log, which is where a durable
record of what happened belongs. That is a record for a person reading it later,
not a channel anything reads programmatically. Nothing else SHALL be written to
disk for it.

#### Scenario: No run sees the account

- **WHEN** any verb runs
- **THEN** nothing in its prompt, parameters, or tool surface contains or derives from the token account

#### Scenario: Iris does not speak the account

- **WHEN** the account changes, by any amount
- **THEN** nothing is spoken about it, and no announcement is queued

#### Scenario: The ceiling remains the only thing that acts on spend

- **WHEN** an engine's account grows large
- **THEN** no work is refused, trimmed, or altered because of it
- **AND** the only limits applied to a run remain its own declared turn and spend ceilings

