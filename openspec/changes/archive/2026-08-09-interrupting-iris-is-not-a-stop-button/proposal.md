## Why

The first real session with the canvas conversation, on 2026-08-09, produced
the evidence two of its requirements were wrong. Both were mine, and both were
reasoned rather than measured.

**Barge-in was cancelling work.** `serverContent.interrupted` was read as "the
user redirected me", so it ended the in-flight turn. In a real conversation
that signal fires constantly: it means Iris's audio turn was pre-empted, which
happens when the user says "ừ", asks a follow-up, or simply thinks aloud over
the answer. The log has it plainly — the user asked why the boxes on the
diagram had no text, Claude's turn was three seconds old, the user kept
talking, and the turn was killed. Their next sentence was "Bị lỗi gì vậy mà
không đọc được Canvas vậy?" They were not interrupting; they were waiting, and
the work had silently stopped.

**Canvas mode was announced five times in four minutes**, twice over Iris's own
answer. The announcement fires per panel activation, on the reading that
reopening the surface is entering the mode again. The panel re-activates for
reasons that have nothing to do with the user opening it, and a greeting
repeated mid-conversation is not a greeting — it is an interruption, and the
mode had not ended in between.

Both defects produce the same complaint, which is what the user reported: the
exchange does not feel continuous, and context is lost.

## What Changes

**An interruption stops the speech, not the work.** Gemini already stops
speaking on its own. Nothing about an interruption reaches the run layer as a
cancellation, so a turn the user asked for survives them making a noise over
it. Barge-in as a way to *cancel work* would need a signal meaning "the user
redirected me", which `interrupted` is not.

**Canvas mode is announced once per engagement**, not once per activation — on
the same terms as the engagement flag itself, which is already sticky because
the mode does not end when the panel is hidden.

## Impact

- Specs: `canvas-claude-mcp` (MODIFIED)
- Main: `electron/live-messages.mjs`, `electron/wiring-live.mjs`, `electron/wiring.mjs`, `electron/capabilities/canvas.mjs`
- Evidence: `~/.myiris/logs/iris.log`, session of 2026-08-09 14:53–14:57
