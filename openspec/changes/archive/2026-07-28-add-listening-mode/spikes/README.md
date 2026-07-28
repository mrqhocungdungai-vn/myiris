# Spikes behind `add-listening-mode`

Throwaway scripts kept for one reason: the design in `../design.md` rests on measured behavior of
the Gemini Live API that its own SDK documentation does not imply, and twice contradicts. Two designs
that read correctly from the docs were proven not to work. If someone later doubts a decision, the
honest answer is "re-run the spike", not "re-read the docs".

**These are not tests.** They hit the live API, need `GEMINI_API_KEY`, and consume quota — all three
of which `docs/TESTING.md` forbids in the vitest suite. Nothing in `npm test` runs them.

## Running

```bash
./make-clips.sh                # regenerate the audio (macOS: say + afconvert)
node spike-listen4.mjs         # the load-bearing one
```

`GEMINI_API_KEY` is read from the repo `.env`. The `@google/genai` import resolves through the repo's
own `node_modules`. The `*.wav` / `*.aiff` artifacts are generated, not committed.

Each script **exits non-zero when its finding does not reproduce**, so a re-run can be scripted rather
than eyeballed. Transport errors and unexpected closes count as failures, not as a quiet asterisk on a
PASS.

## What each one established

| Script | Question | Result |
| --- | --- | --- |
| `spike-listen.mjs` | Does `sendClientContent({turnComplete:true})` commit accumulated realtime audio? | **No.** With AAD disabled and no `activityStart`, the server discards everything: empty `inputTranscription`, model answers that it heard nothing. → Decision 2 |
| `spike-listen2.mjs` | Does audio inside an explicitly opened activity get retained, and stay silent? | **Yes.** Activity open → 0 audio chunks, 0 `turnComplete`. `activityEnd` → recall. Reconnect with the handle → context survives a config change. → Decisions 2, 4 |
| `spike-listen3.mjs` | Can the mode exit silently? Can one session serve several asks? | Silent exit **loses everything** (uncommitted activity is never committed) → Decision 4. Repeated `activityStart`/`End` cycles inside one session **do** work → Decision 11 |
| `spike-listen4.mjs` | Does context survive chunking with a reconnect at every boundary? | **Yes**, but only once the boundary waits for the resumable handle. Three chunks, three reconnects: a question answerable only from chunk 1 was answered correctly, and a summary merged all three. → Decisions 3, 5, 6, 7 |
| `probe-handle.mjs` | When does the server issue a resumption checkpoint? | **Never while an activity is open** — 0 updates in 160 s. → Decision 5 |
| `probe-handle2.mjs` | Does closing the activity unlock one? | **Yes**, `resumable=true` handle 0.6 s after `turnComplete`. → Decision 5 |
| `probe-goaway.mjs` | Does `goAway.timeLeft` leave room for a ~2.5 s boundary? | **Inconclusive** — session terminated at 241 s by `Resource has been exhausted`, before `goAway` fired. Accidentally demonstrated the failure it was probing for: the connection died with the activity open, so no fresh handle existed. → Decision 3's timer margin, and the risk list |

## Reading `spike-listen4.mjs`'s output

The load-bearing assertion is **`F`** — a question answerable only from chunk 1, asked after three
reconnects. It passed on both runs of the final script.

The line under it, `all chunks present in full summary`, is a weaker check and reported `PASS` on one
run and `partial — missing chunk 1` on another. That is not a context loss: the summary question asks
who does what and when the review is, so an answer that omits the budget is answering correctly. `F`
in the same run confirmed chunk 1 was still in context. Treat that line as informational; only `F`
regressing means something broke.

## The trap worth knowing about

`spike-listen4.mjs` failed completely on its first run and the design looked wrong. It was not: the
script closed the session at `turnComplete`, which is the natural-looking end of the sequence, and
therefore threw away the handle that only arrives afterwards. Waiting for the handle turned every
assertion green with no other change.

That failure is silent and total — sessions connect, Iris stays quiet, Iris answers when asked, and it
has retained nothing. It is why the boundary ordering is specified in
`../specs/listening-mode/spec.md` instead of left to implementation, and why task 2.6 asserts it.

**The same trap has a second form, which the assertions now guard against.** "Wait for a resumable
handle" is vacuous if a handle is already in hand: `electron/main.mjs` keeps one in a module-scoped
variable, so production enters listening mode already holding a handle from the converse session, and a
naive wait returns instantly. `spike-listen4.mjs` therefore nulls the handle immediately before
`activityEnd`, aborts rather than inheriting the previous chunk's handle, and reports
`fresh handle at every boundary` in its verdict. `probe-handle2.mjs` likewise now separates handles that
arrived *before* `activityEnd` from those after, because only the latter support its verdict.

## Assertion hygiene, learned the hard way

Three ways these scripts previously could have reported PASS while the thing under test failed. Kept
here because the same shapes recur:

- **Substring recall.** `hits()` does `includes()`, so the bare syllable `"chín"` matches `"chính"` —
  a reply saying *"tôi không nghe chính xác"* would have scored as successful recall and inverted
  Decision 2's finding. Fact lists now use multi-word forms only.
- **Inherited state.** Any check for "did X arrive" must be scoped to the window it claims, or earlier
  state satisfies it. This is what bit the handle wait in both `spike-listen4` and `probe-handle2`.
- **Degenerate values passing a bound.** A word-count check of `<= 4` accepts 0, so an empty reply read
  as "kept short by prompt". Bounds now have a floor.

Silence is also judged over an 8 s window, matching `spike-listen2`; the 2.5 s the chunked spike first
used is too short to call it silence.
