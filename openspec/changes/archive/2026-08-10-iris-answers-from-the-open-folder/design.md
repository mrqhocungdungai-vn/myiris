## Context

See proposal.md — Why. What the code already provides, and what shapes the approach:

- **The capability contract exists.** `electron/capabilities/` modules return `{ toolDeclarations, promptFragment, ipcHandlers, probe, teardown }`; `gemini-tools.mjs` concatenates the declarations and `gemini-prompts.mjs` splices the prose. Nothing core needs to learn about a new capability.
- **Worker-free tools are an established class.** `capture_note`, `find_note_by_name` and `mutate_vault_notes` are each dispatched from the switch in `run-dispatch.mjs` and each deliberately left out of `PIPELINE_ONLY_TOOLS`, with the reasoning written at the case. This is a fourth member of that class, not a new idea.
- **The open folder already exists and is already known to the voice layer.** `announcements.mjs`'s `workspaceInfo()` returns `project_folder` from the active workstream's `cwd`, the user picks it from the UI, and `get_workspace_info` reports it to Gemini today.
- **Nothing can fire early.** `listen-only-mode` requires every tool call to be refused while the mode is engaged, and `live-messages.mjs` enforces it before dispatch. The settling step therefore cannot start until the mode ends, without anything being built to prevent it.
- **`listen-window-is-bounded` already rewrote both in-band notes.** `LISTEN_ONLY_DISENGAGE_REQUEST` currently tells Iris to wait until the user speaks. That sentence is the seam this change reaches through.

## Goals / Non-Goals

**Goals:**

- The fast path is genuinely fast: local file reads, no run, no queue, no credential.
- The user's prepared words reach the audience unaltered.
- Iris never spends money or airtime on her own initiative during a live session.

**Non-Goals:**

- A new verb. The two fallbacks are existing verbs, offered and dispatched on their existing terms.
- Retrieval quality work — ranking, embeddings, an index. The prepared folder for one talk is small; anything more is solving a problem this does not have.
- Reaching into the notes vault. That is a route the user chooses, not one this takes.
- Any change to the listening window, the silence guarantee, or system audio.

## Decisions

### D1: "The folder the user has open" is the active workstream's `cwd`

Not a new setting. The concept already exists, the user already picks it from the UI, and `get_workspace_info` already tells Gemini what it is — so the folder Iris searches is the folder Iris can already name.

It also makes the miss path coherent. "Search it properly with Claude Code" runs a verb, and verbs already run in that same `cwd`. One folder, searched two ways at two prices, rather than a cheap search of one folder and an expensive search of another.

Alternative considered: a dedicated "prepared materials" folder, configured separately. Rejected — it introduces a second folder concept that must be kept in sync with the first, and it makes the escalation incoherent: the agent fallback would search somewhere the quick lookup never looked.

**When no folder is selected**, the lookup SHALL say so rather than searching the default workspace (`~/.myiris/workspace`). That directory is a fallback for Claude's file work, not a place the user prepared anything.

### D2: The lookup returns material; Gemini does the matching

The function reads the folder's prepared text and returns it, bounded, verbatim. It does not decide which passage answers the question.

This is the same argument that decided `listen-window-is-bounded`: do not put a lossy text step where the model that has the audio can do the work. Gemini heard the question in the form it handles best. A local scorer would be matching a keyword bag against text whose phrasing the asker never saw — the fragile step in the whole chain, introduced for no gain, because the material a single talk's prep folder holds fits comfortably in context. Fifty prepared questions and answers is on the order of ten thousand tokens against a 131,072-token window.

Local scoring appears only as the **overflow** strategy: when the folder holds more than the bound, the app narrows and says that it narrowed. Silent truncation is what turns "nothing was prepared for that" into a lie, and a user who prepares against a system that lies about its own coverage prepares wrong.

Alternative considered: local fuzzy matching returning a single best answer. Rejected on the above, and because a wrong single answer read confidently to an audience is the worst failure this feature can produce.

### D3: Announce, then read on the user's cue — **the decision most worth challenging**

The two things the user described pull in opposite directions: *"if I know the answer I will answer it myself"*, and *"if found, say found and read it out"*. Both cannot be the default.

Resolved by asymmetry of cost. If Iris waits and the user wanted her to read, the cost is one beat. If Iris reads and the user meant to answer, she talks over a live presentation in front of an audience — unrecoverable, and visible to everyone. So the default is announce-and-wait, and the user hands over the floor deliberately.

This is one sentence in the prompt fragment. If it turns out that in practice the user always wants the answer read immediately, flipping it is a prose change and not a redesign.

### D4: The settling step is a sentence, not a mechanism

`LISTEN_ONLY_DISENGAGE_REQUEST` already fires at exactly the right moment, in-band, without asking for a reply. It currently ends with "wait until the user next speaks to you". That becomes: look in the open folder now, and say one line if you found something.

No new event, no new IPC channel, no new hook in `live-session.mjs`. The note it replaces was already the disengage seam; this changes what the seam says.

Nothing is needed to stop the lookup firing while the mode is still engaged, because `listen-only-mode` already refuses every tool call in that state, in the main process, before dispatch.

### D5: Which files count as prepared material

`.md` and `.txt` only, read as UTF-8, recursive from the folder root with `.git`, `node_modules`, `dist`, `build` and dotted directories skipped, under a file-count cap and a total-size cap.

The narrow extension list is the main guard against the realistic mistake — the workstream pointed at a code repository rather than a prep folder. That case then returns a README and little else, which produces "nothing prepared for that" rather than anything harmful.

### D6: Prepared text is fenced on the way to the model, and read out unfenced

The content goes through `fenceUntrustedText`, as note titles and tags already do. It is the user's own material, but it is file content reaching a voice model, and it can contain sentences shaped like instructions — including material the user copied in from elsewhere. The fence is a label for the model, not a transform of the text: what Iris reads aloud is the prepared wording, unchanged. The spec states the verbatim requirement for exactly this reason.

## Risks / Trade-offs

**The workstream is pointed at a code repository, not a prep folder, and the lookup scans source trees.** → Bounded by D5's extension list, skip-list and caps. The failure mode is an unhelpful "nothing prepared", not a slow or dangerous one. The prompt fragment says which folder is being searched, so the user can see the mistake.

**A folder large enough to overflow the bound gives an answer drawn from part of the material, and the user reads that as full coverage.** → The overflow is stated in the result, and the spec makes stating it a requirement rather than a courtesy.

**Announce-and-wait costs a beat in front of an audience.** → Accepted, with the asymmetry argument in D3, and flagged there as the decision to revisit first if it grates in practice.

**The lookup fires on every disengage, including ones where nothing was asked.** → It reads a handful of small text files with no run and no queue; a miss returns nothing and, per the modified `listen-only-mode` requirement, Iris then says nothing at all. A useless lookup is silent and nearly free.

**Prepared material reaching the model could carry instruction-shaped sentences.** → Fenced as untrusted on the same terms as every other file-sourced text in this app, and the tool refusal during the engagement means nothing in the heard audio can trigger this in the first place.

## Migration Plan

Purely additive. No configuration to migrate; a user with no prepared folder gets the same "nothing prepared" answer as one with an empty folder, and everything else behaves as it does today. Rollback is `git revert` — the only behavioural residue is the one line the disengage may now produce, which reverts with the prompt string.
