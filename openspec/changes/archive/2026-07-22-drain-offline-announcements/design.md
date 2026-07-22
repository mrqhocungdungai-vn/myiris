## Context

`notifyIris` (`main.mjs:559-566`) is the single delivery mechanism for every `SYSTEM_EVENT_*` announcement. Its docstring already states the intended contract — send immediately if connected, otherwise buffer for redelivery. The buffer half works; the redelivery half is dead:

```js
liveSession = await ai.live.connect({          // 2251 — liveSession assigned only when this RESOLVES
  callbacks: {
    onopen() {                                  // fires DURING connect, before the assignment lands
      ...
      while (pendingClaudeAnnouncements.length > 0 && liveSession) {   // 2262 — liveSession still null → never runs
        liveSession.sendRealtimeInput({ text: pendingClaudeAnnouncements.shift() });
      }
```

`liveSession` is `null` at every reachable `onopen`: first connect early-returns if it is non-null (`main.mjs:2213` guard region), and both reconnect paths null it before reconnecting (`onclose` at 2278, the reconnect catch). So `&& liveSession` is always false and the buffer only ever grows.

The correct pattern is already in this file. `previewVoice` (`main.mjs:1035-1036`) comments the exact hazard — "onopen can fire before the session variable is assigned, so triggering inside onopen would no-op" — and sends after the `await` resolves. This change applies the same fix to the main path.

## Goals / Non-Goals

**Goals:**

- Buffered announcements are actually delivered on (re)connect, restoring conformance with the `session-announcements` spec.
- The buffer cannot grow without bound across a long disconnection (the append-only leak).
- The fix mirrors the already-correct `previewVoice` pattern, so the two paths are obviously the same shape.

**Non-Goals:**

- Changing *which* announcements are eligible (BUG A', Wave 0.3, done — the started/not-cancelled gate).
- Changing immediate delivery or the `bufferIfOffline` opt-out — both correct.
- Persisting the buffer across process restarts — announcements are ephemeral state-change notices; a restart legitimately drops them.

## Decisions

### D1 — Drain after `connect` resolves, not inside `onopen`

**Chosen:** extract `drainPendingAnnouncements()` (immediate-send each buffered entry in FIFO order), delete the `while` loop from `onopen`, and call the helper on the line after `liveSession = await ai.live.connect(...)` resolves.

This is the root-cause fix, not a workaround: the drain reads `liveSession`, so it must run at a point where `liveSession` is assigned. `onopen` is definitionally too early. After the `await` it is guaranteed assigned (the socket is open — `onopen` already fired). Matches `previewVoice:1035`.

*Assigning `liveSession` before `connect` resolves (e.g. capturing the promise's eventual value some other way) considered and rejected:* the SDK returns the session only on resolution; there is no earlier handle, which is exactly why `previewVoice` waits.

### D2 — Ordering vs `GreetGate.arm()` is benign

After the hoist, the drain runs *after* `onopen` (which calls `GreetGate.arm()` on first connect), where today's dead loop sat *before* the arm. This is the more correct order anyway — settle state, then greet. And it is moot on the path that matters: `GreetGate.arm()` fires only on `!isReconnect` (first connect), when nothing has buffered yet; on reconnect — the only time the buffer is non-empty in practice — the gate is not armed at all. So there is no interaction to guard.

### D3 — Bound at the push site, drop-oldest

**Chosen:** cap `pendingClaudeAnnouncements` at ~20 entries; on push past the cap, drop from the front. A tiny bounded-push (`push`, then `if (len > MAX) shift()`), or a small helper.

Drop-oldest, not drop-newest: these are state-change notices and completion results, where the most recent is the most relevant to speak on reconnect. Under normal operation (a handful of events per ~10-min reconnect cycle) the cap is never reached, so nothing is dropped in practice; the cap exists to stop a pathological long offline stretch from leaking. The spec's "rather than dropping it" guarantee is now scoped to within the bound — that is the one real behavior change and the reason this change carries a spec delta.

*Time-based expiry considered and rejected:* a stale completion is still worth reading on reconnect (the user asked for that work); size is the resource we are actually protecting, so bound size.

## Risks / Trade-offs

**A burst of >20 announcements while offline drops the oldest** → acceptable and intended; the newest state is preserved and the cap is generous relative to the ~10-min reconnect cadence. Documented as the spec delta.

**Double-delivery if the drain ran twice** → the helper drains by `shift()`, emptying the buffer as it goes, so a second call finds it empty. Only called once per successful connect. Low risk.

**Ordering of a completion vs the greeting** → see D2; benign on the path that matters.

**No automated coverage** → `main.mjs` is out of test scope (Wave 0.0 D5). If the bounded-push is extracted into a pure helper (a `pushBounded(arr, item, max)` or similar in a small testable module) it can carry a unit test for the drop-oldest behavior; the delivery timing itself is verified manually (tasks 4).
