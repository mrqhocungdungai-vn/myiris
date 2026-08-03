# Design

## Context

Depends on `agent-sdk-conformance` for five things: the single prompt policy, per-run budgets, caller-supplied `skills`, structural tool restriction (`disallowedTools`), and the bounded transcript ring. Nothing here should re-derive any of them.

The refactor is sequenced so the registry lands before anything reads from it, and the interface changes last — the deck is the least reversible surface and the easiest to get wrong before the model underneath has settled.

## Decisions

### D1 — The axis is stateful vs stateless, not PO vs DEV

"PO" and "DEV" each bundled two unrelated properties: *who the worker is* (a persona) and *how the run behaves* (resident-and-may-ask vs one-shot-and-never-asks). Only the second one matters to the runtime, and it is the one the names hid.

**Decision:** the runtime axis is named for the property. `stateful` means **may pause mid-turn and ask by voice** — nothing more. In particular it does **not** mean "remembers previous calls": every verb resumes its own prior conversation via `resume`, stateless included.

Conflating continuity with statefulness is what made `investigate` look like it needed a resident session. It does not. It needs `resume`, which is free.

### D2 — The verb registry is one table whose fields may be functions

Three hand-wired copies of a verb's definition — one in the Gemini declaration, one in the dispatch gate, one in the `query()` options — is the exact mechanism that produced F1: two call sites building the same thing with nothing forcing them to agree.

**Decision:** `electron/verbs.mjs` holds one record per verb. `gemini-tools.mjs` derives declarations from it, `run-dispatch.mjs` derives the park label, `run-exec.mjs` derives the `query()` options. Fields may be functions where the value genuinely depends on state — `execute`'s skill list depends on whether the project has an open change (D4). Pure data would force those verbs into separate modules and reintroduce two places to look.

The registry is Electron-free and its resolution is a pure function of `(verb, project state)`, so the whole table is testable without booting anything.

### D3 — Two stateful verbs, one shared resident session

`shape_requirements` and `shape_on_canvas` are the same conversation in two media. Switching to the canvas happens precisely when talking has stopped working — which is the moment the accumulated context matters most.

**Decision:** both map to a single resident session keyed `stateful`. Consequences accepted deliberately:

- **They cannot run on different models while the session is live.** `po-session.mjs:266`'s `setModel()` switches the whole session. The registry declares this dependency rather than pretending each verb owns its model.
- **The session is opened by whichever verb is called first**, and the park-on-opening rule (D6) attaches to the *session*, not to either verb.

### D4 — `execute` forks on disk state; the spec-gate is removed on the record

`run-exec.mjs:142` fails a DEV run when no open change has unchecked tasks. Under a verb surface that refusal is wrong: the user asked for work, and "there is no OpenSpec change" is not a reason to refuse to write a note-sized script.

**Decision:** `execute` reads the project at dispatch. An open change with unchecked tasks means `/opsx:apply` and the OpenSpec workflow skills. No open change means ordinary work with no process skills loaded.

**This removes the gate that prevented implementation without a spec.** Recorded as a decision so a later reader does not mistake it for a regression. The reasoning: the gate's real protection was against an *unattended* run free-coding, and that protection now comes from `execute` being parked for review on every call (D6) rather than from a refusal that also blocked legitimate small work. If the park is ever weakened, this decision must be revisited with it.

### D5 — Capture is a free file append; synthesis is a deliberate verb

Spawning a `capture_learning` run after every run would double the run count, double cost, and — because `run-queue.mjs` holds a single global execution slot — block the user's next request behind bookkeeping.

**Decision:** on `runQueue.finalize`, append one record (verb, task, outcome, cost, error, tools used) to a dated file under the vault inbox. Plain `fs`: no tokens, no latency, no slot. `capture_learning` reads the inbox and runs `wiki-crystallize` / `wiki-integrate` when called, and Iris may suggest it when the inbox is worth processing.

Raw capture is a log; synthesis is the learning. Separating them means the log can never be lost to a busy queue, and the expensive step happens when there is enough material to be worth it.

### D6 — Park is a declared verb property, scoped to the phase for stateful verbs

An earlier draft derived the review tier from the resolved role, the presence of a project folder, and the configured budget. That was a heuristic. Once verbs exist, **the verb is the risk signal** — explicit, enumerable, and inspectable.

**Decision:**

- `execute` and `finish` park on **every** call. Each is a fresh one-shot run that writes to the repository; each call is a new risk.
- `shape_requirements` / `shape_on_canvas` park only on the call that **opens** the resident session. Subsequent steering turns dispatch directly.
- `investigate`, `review`, `capture_learning` never park.

The phase scope is what keeps a spoken interface usable: a grilling conversation is many turns into one already-approved session, and requiring approval per turn would send the user to the screen mid-sentence. The consent unit is the *conversation* for stateful verbs and the *run* for stateless ones — which is exactly the difference between them.

Enforcement is at dispatch in `run-dispatch.mjs`, reading the registry. It does not depend on Gemini honoring an instruction, because F1 and F4 established that prompt-level promises do not hold.

### D7 — The transcript is context, not the instruction — except where the model can ask

The conformance change makes the verbatim transcript retrievable. What it is *for* differs by verb, and the difference follows directly from D1.

**Decision:** every verb receives the recent fenced transcript as supplementary context. The schema differs:

- **Stateful verbs take a thin schema** (`said` plus a one-line reading). The model is the strongest available, holds the session context, and can pause to ask by voice — a thin brief is a starting point it repairs, not a loss. Forcing Gemini to enumerate details here would be *worse*: enumeration is summarization, and summarization drops things.
- **Stateless verbs keep concrete parameters as the instruction**, with the transcript as background to check against. A one-shot run carrying `disallowedTools: ["AskUserQuestion"]` cannot recover from a vague brief — handing it rambling speech would be delegating an ambiguous job to a worker forbidden to ask.

Fencing is mandatory on both paths, per the conformance spec: the microphone does not distinguish who is speaking near it.

### D8 — Migration maps forward and discards no conversation

`CLAUDE.md` promises context resets *"ONLY when the user explicitly starts a new session… or picks a different project folder."* An app upgrade is not the user asking.

**Decision:** on load, `agent_sessions.po` → `stateful`; `agent_sessions.dev` and `.default` both map to `execute`, with `last_agent_used` deciding which one wins and the loser retained under an archive key rather than deleted. `agent_models.po` → the stateful verbs, `.dev` → the stateless ones. `active_agent` is dropped; a workstream no longer has a current role.

The archive key exists because the collision is real and lossy either way — keeping the loser costs a string and makes the migration reversible.

### D9 — Role names leave the prompt, not the product

Removing PO and DEV from the user-facing vocabulary must not make the system opaque.

**Decision:** Iris speaks about the *phase* — settling requirements, building, checking what remains — in ordinary conversation, and names the underlying machinery when the user asks how it works or when a run fails inside a specific verb. Run cards keep the verb badge: the deck is a technical surface, and hiding it there only makes diagnosis harder. What is removed is the requirement that the *user* holds the vocabulary in order to get work done.

## Risks / Trade-offs

- **More ways to misroute.** Today Gemini can only get "is this Claude work" wrong; now it can get "which of seven" wrong. Mitigated by parking `execute` and `finish`, by the registry being pure and exhaustively tested, and by logging every decision with its inputs. **Not fully mitigated**: a wrong `investigate` or `review` spends money quietly. Accepted, because the alternative — parking everything — is what makes users disable the gate.
- **D4 removes a safety gate.** Stated on the record above. The park is now the only control on unspecced implementation; weakening one requires revisiting the other.
- **D3 couples two verbs' models.** Accepted: the shared context is worth more than independent model selection on a conversation the user is having in real time.
- **The registry could become the place everything accumulates.** Mitigated by keeping it to declared fields plus small pure resolvers; anything needing real logic gets a module the registry references, not an inline block.
- **The bottleneck narrows but does not close.** Gemini still picks the verb and writes the summary line. The transcript means a bad summary is no longer the only thing Claude sees — it does not mean Gemini can no longer pick the wrong verb.
- **Deprecating `submit_claude_task` means two dispatch surfaces for one release.** Accepted: a Gemini session resumed mid-conversation would otherwise call a tool that no longer exists.
