## REMOVED Requirements

The whole capability is retired. Listening mode reached silence by reconnecting the Gemini Live session with a second config profile — on enter, on exit, and on every chunk rotation — and each reconnect is a visible seam in a conversation meant to feel continuous. `listen-only-mode` reaches the same silence by discarding audio at the output, with no reconnect at any transition, so the machinery below has nothing left to serve.

The shared migration for every requirement here: engage `listen-only-mode` instead. It keeps Iris silent while she keeps hearing the user, and her replies arrive as transcript text, so the conversation's context is preserved without any of the chunking, boundary or synthesis machinery. What is deliberately **not** carried over is monologue protection: `listen-only-mode` leaves activity detection enabled, so Iris will interject at pauses — silently, in text — instead of holding until the mode ends. There is no cheap substitute: activity detection can only be set when a session is established, and establishing a session is the reconnect being removed. To recover the old behavior, revert to a commit before this change lands.

### Requirement: Iris hears everything while listening mode is engaged and cannot speak

**Reason**: Structural silence was achieved by reconnecting with a listen config (empty tool set, automatic activity detection disabled). `listen-only-mode` achieves audible silence without touching the session config, so no second profile exists to be structurally silent in.
**Migration**: See the shared migration above. Iris is silent but no longer structurally prevented from taking a turn.

### Requirement: Retention requires an explicitly opened activity

**Reason**: Explicit activity framing (`activityStart`/`activityEnd`) only exists because the listen config disabled automatic activity detection. With that config gone, retention is governed by ordinary automatic activity detection again.
**Migration**: None. Ordinary turn-taking retains what the user says, as it does outside the mode.

### Requirement: The whole stream counts, including pauses

**Reason**: Pause-spanning retention was a property of the listen config's turn-coverage setting. Without that config there is no separate coverage rule to state.
**Migration**: None. A pause now ends a turn as it does in ordinary conversation.

### Requirement: Listening is chunked, because one activity cannot outlive the connection

**Reason**: Chunking existed solely to keep one long activity alive across the Live connection's lifetime limit. `listen-only-mode` opens no long-lived activity, so there is nothing to chunk. `IRIS_LISTEN_CHUNK_MS` is removed.
**Migration**: Remove `IRIS_LISTEN_CHUNK_MS` from any `.env`; it is ignored if left in place. Ordinary reconnect handling covers the connection lifetime, as it does for every other session.

### Requirement: Every boundary captures a resumption handle before the session is disconnected

**Reason**: Boundaries only existed to bridge chunk rotations. With no rotation there is no boundary, and the ordinary resumption-handle path already covers the reconnects that remain.
**Migration**: None; the ordinary session-resumption behavior is unchanged.

### Requirement: Every boundary turn is neither heard nor shown

**Reason**: Main-process suppression of boundary turns is unnecessary once no boundary turn is ever driven.
**Migration**: None. No turn is hidden from the transcript by this mode; every reply appears as text.

### Requirement: Segment records live in process memory only

**Reason**: The in-memory segment record existed to feed the exit synthesis. With no synthesis there is nothing to accumulate.
**Migration**: None. The record was never written to disk or the vault, so nothing persisted needs cleaning up. The ordinary transcript keeps the conversation visible instead.

### Requirement: Ending listening mode commits what was heard and Iris speaks its synthesis

**Reason**: The exit synthesis existed because nothing Iris produced during the mode had reached the user, so a catch-up summary was needed. Under `listen-only-mode` Iris replies throughout, in text, so there is nothing to catch up on.
**Migration**: None. Iris's replies are already in the transcript when the mode ends. Ask her for a summary in the ordinary way if one is wanted.

### Requirement: Entering listening mode is confirmed once, then Iris goes silent

**Reason**: The spoken entry confirmation was driven by a forced turn immediately after the listen-config reconnect. `listen-only-mode` neither reconnects nor forces a turn, and its state is visible on the control, the orb and the tray.
**Migration**: None. The engaged state is shown by the headphone control's state, the orb's silent-reply state, and the tray label.

### Requirement: Mode transitions are atomic

**Reason**: Atomicity guarded a multi-step transition (close, reconnect, drive a turn, reopen an activity). A `listen-only-mode` transition is a single state change with nothing to interleave.
**Migration**: None; there is no multi-step transition left to protect.

### Requirement: A failed transition leaves a coherent state

**Reason**: A transition that can fail requires recovery rules. Toggling `listen-only-mode` cannot fail: it performs no I/O and no session operation.
**Migration**: None.

### Requirement: An unexpected disconnect ends listening mode

**Reason**: This rule reconciled the mode's own deliberate reconnects with genuine failures. `listen-only-mode` performs no reconnects, and it already resets when the session ends, which `listen-only-mode` states as its own requirement.
**Migration**: See `listen-only-mode`'s ephemerality requirement — the mode resets to disengaged whenever the session ends, by user stop or server teardown.

### Requirement: No announcement text is injected while the mode is engaged

**Reason**: Injection had to be withheld because the listen config disabled activity detection, so injected text would either interrupt the monologue or be discarded by the server. `listen-only-mode` keeps activity detection on and turn-taking ordinary, so injection is safe and arrives as text.
**Migration**: See the `session-announcements` delta — a connected session is deliverable again, and buffering applies to a disconnected session only. Announcements now appear as transcript text while the mode is engaged instead of being held.

### Requirement: Listening mode is ephemeral per session

**Reason**: Replaced by the equivalent requirement on `listen-only-mode`, which carries the same rules — reset on session end by stop or teardown, no-op while asleep, never persisted.
**Migration**: Behavior is preserved; see `listen-only-mode`'s ephemerality requirement.

### Requirement: Listening mode is reachable from three control surfaces

**Reason**: Replaced by the equivalent requirement on `listen-only-mode`, which inherits this feature's control identity: the `IRIS_LISTEN_HOTKEY` hotkey (default `Alt+L`), a tray item, and a renderer control — now a headphone icon, and now the only such control in the cluster rather than one of two.
**Migration**: `IRIS_LISTEN_HOTKEY` keeps its name and default and now toggles `listen-only-mode`; no user configuration needs changing. The separate ear-icon control and its tray item are gone, collapsed into the headphone control.

### Requirement: The mode's reconnects are distinct from failure reconnects

**Reason**: The distinction only existed because the mode performed deliberate reconnects that had to bypass the failure-backoff path. It performs none now.
**Migration**: None; every reconnect is once again a failure reconnect and takes the ordinary path.

### Requirement: Ordinary conversation is unchanged when listening mode is off

**Reason**: This requirement fenced off a mode that reconfigured the session. `listen-only-mode` never reconfigures it, so there is no second configuration for ordinary conversation to be protected from — the guarantee is now structural rather than something to assert.
**Migration**: None. Conversation with the mode disengaged behaves exactly as before, and `buildLiveConfig` returns to a single configuration with no mode parameter.
