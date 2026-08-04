## MODIFIED Requirements

### Requirement: The canvas server is wired Iris-scoped, per run, to the verb that declares it

The canvas tool server SHALL be provided Iris-scoped and per run, without writing to `~/.claude`, to the runs of the **verb that declares it** and to no others. The declaring verb's runs SHALL receive it via the SDK `mcpServers` option — and, on a resident session opened by a sibling verb that did not declare it, via the live-session equivalent applied at most once. It SHALL carry the localhost server URL and the session token, and SHALL make the canvas tools available in the run's first turn without requiring a tool-search step.

Wiring it into **every** run, as this requirement previously mandated, gave the canvas tools to runs with no connection to drawing and made the server a per-run special case rather than a declared capability. Which runs may reach it is now a property of the verb, read from the registry.

#### Scenario: The canvas verb's run can use the canvas tools

- **WHEN** a canvas run starts while the canvas tool server is available
- **THEN** that run has the canvas read/write tools without any change to `~/.claude`

#### Scenario: A verb that does not declare the server never receives it

- **WHEN** a run of any other verb starts while the canvas tool server is available
- **THEN** no canvas tool server is wired into it, and the server is not even consulted

#### Scenario: A shared session gets it on the turn that needs it

- **WHEN** a resident session was opened by a verb that does not declare the server, and a later turn into that same session is made by the verb that does
- **THEN** the server is wired into the live session for that turn, without closing or resuming it

## ADDED Requirements

### Requirement: The canvas is a verb Iris can call, not prose routed around a gate

Working on the canvas together SHALL be reachable through a named verb with its own parameter schema, wired to the canvas tool server from the verb registry.

It SHALL NOT be offered only as prose in the voice layer's system instruction directing it toward a general-purpose task tool. In particular, the canvas capability SHALL NOT carry instructions warning the voice layer away from a worker that would refuse the request for reasons unrelated to drawing. A capability that must describe a pipeline gate it has nothing to do with is being routed around rather than served.

#### Scenario: Canvas work has its own function

- **WHEN** the voice layer's tool declarations are built and the worker is available
- **THEN** a declaration exists for canvas work, with its own parameters

#### Scenario: No workaround for an unrelated gate

- **WHEN** the canvas capability's contribution to the voice layer is built
- **THEN** it contains no instruction steering away from a worker on grounds unrelated to the canvas

#### Scenario: The tool server is wired from the registry

- **WHEN** a canvas run starts
- **THEN** the canvas tool server is wired from that verb's registry entry, not from a per-run special case

### Requirement: Moving to the canvas continues the conversation

The canvas verb SHALL share its live session with the verb that shapes requirements by voice, so moving to the canvas continues the same conversation rather than starting a second one.

Switching to drawing happens when talking has stopped being enough — which is exactly when the accumulated context matters most. A canvas run that cannot see what was already discussed would ask the user to repeat themselves at the worst moment.

#### Scenario: The canvas sees what was already discussed

- **WHEN** a conversation that began by voice moves to the canvas
- **THEN** the canvas run has the context of that conversation without it being restated

#### Scenario: Either verb may open the shared conversation

- **WHEN** the canvas verb is called with no conversation open
- **THEN** it opens the shared session, and a later voice turn continues that same conversation

## RENAMED Requirements

- FROM: `### Requirement: Both Claude paths are wired Iris-scoped per run`
- TO: `### Requirement: The canvas server is wired Iris-scoped, per run, to the verb that declares it`
