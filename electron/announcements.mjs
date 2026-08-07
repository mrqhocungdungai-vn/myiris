// Voice announcements: the single delivery mechanism for every
// SYSTEM_EVENT_* the app injects into the live conversation, the
// prompt-injection sanitization untrusted third-party text goes through
// before reaching the model, and the workspace-state prose Iris reasons
// from. Split out of electron/main.mjs (split-main-process-modules):
// Electron-free, so the Live session it reads is received as an injected
// accessor.
import fs from "node:fs";
import path from "node:path";
import { fenceUntrustedText } from "./untrusted-text.mjs";

/**
 * @param {{
 *   getLiveSession: () => any,
 *   emitEvent: (event: any) => void,
 *   findWorkstream: (id: string | null) => any,
 *   getActiveWorkstreamId: () => string | null,
 *   runStatus: { CANCELLED: string, LIMITED: string, UNANSWERED?: string },
 * }} deps
 */
export function createAnnouncements({
  getLiveSession,
  emitEvent,
  findWorkstream,
  getActiveWorkstreamId,
  runStatus,
}) {
  // Drop-oldest cap: the newest state-change is the one worth speaking on
  // reconnect, and this stops a prolonged offline stretch from leaking memory.
  const MAX_PENDING_ANNOUNCEMENTS = 20;
  const pendingClaudeAnnouncements = [];

  function userDisplayName() {
    return (process.env.IRIS_USER_NAME || process.env.USER || process.env.USERNAME || "there").trim();
  }

  // Single delivery mechanism for every SYSTEM_EVENT_* voice announcement: send
  // immediately if the live session is connected, otherwise buffer (unless the
  // caller opts out) so a state change that lands mid-reconnect is delivered on
  // reconnect instead of silently lost. Connection is the only deliverability
  // condition — listen-only mode leaves activity detection and turn-taking
  // untouched, so a connected session is always deliverable.
  function notifyIris(lines, { bufferIfOffline = true } = {}) {
    const text = Array.isArray(lines) ? lines.join("\n") : lines;
    const deliverable = Boolean(getLiveSession());
    if (deliverable) {
      getLiveSession().sendRealtimeInput({ text });
    } else if (bufferIfOffline) {
      pendingClaudeAnnouncements.push(text);
      while (pendingClaudeAnnouncements.length > MAX_PENDING_ANNOUNCEMENTS) {
        pendingClaudeAnnouncements.shift();
      }
    }
  }

  // Fencing lives in electron/untrusted-text.mjs now: the Claude-facing side
  // needs the identical mechanism for the verbatim transcript it attaches to
  // every run, and two hand-written fences with nothing forcing them to agree is
  // how one of them ends up weaker. Re-exported here so this module's consumers
  // (and its tests) keep reading it off the announcements surface.

  // Called after `liveSession` is assigned (connect resolved) so the drain
  // actually sees a live session, unlike the old onopen-guarded loop it
  // replaces: onopen fires before that assignment lands.
  function drainPendingAnnouncements() {
    while (pendingClaudeAnnouncements.length > 0 && getLiveSession()) {
      getLiveSession().sendRealtimeInput({ text: pendingClaudeAnnouncements.shift() });
    }
  }

  // What Iris (the voice model) is allowed to know about the current workspace:
  // the active session, its project folder, and the last verb that ran. There is
  // no "active role" any more — a verb is chosen per request, so there is
  // nothing current to report, only something most recent.
  function workspaceInfo() {
    const workstream = findWorkstream(getActiveWorkstreamId());
    const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
    return {
      session_label: workstream?.label ?? null,
      project_folder: cwd,
      project_name: cwd ? path.basename(cwd) : null,
      last_verb_used: workstream?.last_verb_used ?? null,
      note: cwd
        ? `Claude's file/terminal work for this session happens inside ${cwd}.`
        : "No project folder is selected for this session, Claude falls back to the default workspace (~/.myiris/workspace). The user can pick a folder from the UI.",
    };
  }

  function workspaceContextLine() {
    const info = workspaceInfo();
    const folder = info.project_folder
      ? `project folder ${info.project_folder} (project "${info.project_name}")`
      : "no project folder selected yet (Claude falls back to the default workspace)";
    const last = info.last_verb_used ? `, last verb used: ${info.last_verb_used}` : "";
    return `Current workspace: session "${info.session_label ?? "none"}", ${folder}${last}.`;
  }

  // Keep the live voice session in sync when the user changes workspace state
  // from the UI, otherwise Iris only ever knows what the system prompt said at
  // connect time and cannot answer "which project are we working in?".
  function announceWorkspaceUpdate() {
    notifyIris([
      "SYSTEM_EVENT_WORKSPACE_UPDATE",
      workspaceContextLine(),
      "instructions_to_iris: silently remember this as the current workspace state. Do NOT speak or respond to this message.",
    ]);
  }

  // Text the user typed/pasted instead of saying it aloud (a link, a note),
  // voice can't reliably dictate this. Delivered as one more SYSTEM_EVENT_* so
  // Gemini reacts to it exactly like everything else in the live conversation.
  // Deliberately never buffered: the composer UI disables itself while asleep,
  // so there is nothing worth redelivering on reconnect (design.md decision 6).
  function sendContextSupplement(text) {
    const clean = String(text || "").trim();
    if (!clean) return { status: "error", error: "Empty supplement text." };
    const lines = [
      "SYSTEM_EVENT_CONTEXT_SUPPLEMENT",
      `supplement: ${clean}`,
      "instructions_to_iris:",
      "- The user just typed/pasted this instead of saying it aloud (voice can't reliably convey links or precise text).",
      "- CRITICAL: be decisive, do not ask for confirmation first.",
      "- Immediately call the verb that fits, with parameters combining the recent conversation with this supplement (e.g. `execute` to research the linked repo for a feature relevant to what you were just discussing and report whether/how it applies here).",
      "- Choose that verb from what the user is asking now, not from whichever verb last ran.",
    ].join("\n");
    notifyIris(lines, { bufferIfOffline: false });
    return { status: "ok" };
  }

  // Structured decisions as a numbered, speakable list. Rendered here rather
  // than left to the voice layer to derive, so what is read aloud does not
  // depend on the model noticing a heading.
  function renderDecisions(decisions) {
    return decisions
      .map((decision, index) => {
        const lines = [`${index + 1}. ${decision.question}`];
        for (const option of decision.options ?? []) {
          lines.push(`   - ${option.label}${option.description ? ` — ${option.description}` : ""}`);
        }
        if (decision.recommendation) lines.push(`   recommended default applied: ${decision.recommendation}`);
        return lines.join("\n");
      })
      .join("\n");
  }

  // Where a deferred-decisions follow-up should land. The producing run's verb
  // is the addressee (design.md D3) — named concretely rather than gestured at,
  // because "the same role" has no referent once a verb is chosen per request.
  // Runs from before `verb` was threaded through here are the one case with
  // nothing to name; that gets said plainly instead of guessed at.
  function decisionsAddressee(verb) {
    return verb
      ? `\`${verb}\``
      : "the verb that produced them — not recorded for this run, so ask which one before submitting anything back";
  }

  /**
   * @param {{ runId: string, task: string, status: string, output: string, verb?: string|null, usage?: { cost_usd: number|null, num_turns: number|null }|null, decisions?: Array<{ question: string, recommendation?: string, options?: Array<{ label: string, description?: string }> }>|null }} params
   */
  function announceClaudeCompletion({ runId, task, status, output, verb = null, usage, decisions }) {
    // The UI card is correct for any terminal status, so this always emits,
    // only the voice delivery below is conditional.
    emitEvent({
      type: "claude_completion",
      run_id: runId,
      task,
      status,
      output,
      usage: usage ?? null,
      decisions: decisions ?? null,
    });

    // A run the user themselves stopped or tore down (session reset) is not
    // "Claude is back with a result", that's actively wrong for a result the
    // user chose to abandon. It still shows on the UI (above); it's just not
    // read aloud. Every other terminal status (including a fault) stays loud,
    // a silent failure is exactly what the user needs told about.
    if (status === runStatus.CANCELLED) return;

    const eventText = [
      "SYSTEM_EVENT_CLAUDE_COMPLETE",
      `run_id: ${runId}`,
      `status: ${status}`,
      `original_task: ${task}`,
      "instructions_to_iris:",
      `- Proactively tell ${userDisplayName()} Claude has returned.`,
      "- If another conversation is in progress, politely pause it with a short bridge like: Quick update, Claude is back with a result.",
      "- Give a concise spoken summary in 1-3 sentences based on the result below.",
      // Two paths, never both. When the run produced structured decisions they
      // are rendered below as data, so the voice layer is not asked to go
      // hunting for a markdown heading that is no longer there; the prose
      // instruction is kept for runs that did not (a session resumed from before
      // the schema existed, or plain Claude, which has no schema at all).
      ...(decisions?.length
        ? [
            `- This run deferred ${decisions.length} decision${decisions.length === 1 ? "" : "s"} to the user, listed below as data. Read each one aloud with its options and the recommended default, collect the choice, then submit a follow-up task to ${decisionsAddressee(verb)} stating what was chosen.`,
          ]
        : [
            `- If the result contains a 'Decisions needed' section, read each decision aloud with its numbered options and the recommendation, collect the user's choice, then submit a follow-up task to ${decisionsAddressee(verb)} stating the chosen options.`,
          ]),
      "- Ask whether he wants to go through the details before continuing the current conversation.",
      "- Do not say you personally did the work; Claude did.",
      // A ceiling termination is not a failure, and describing it as one sends
      // the user looking for a bug that is not there.
      ...(status === runStatus.LIMITED
        ? [
            "- This run did NOT fail: it reached the turn or spend ceiling Iris puts on every run. Say so plainly, tell him which ceiling and its value (the result text below names both), and that the work it did complete still stands.",
          ]
        : []),
      // ask-when-unspecified D3/4.5: the one terminal status where the danger is
      // not misreporting a failure but implying a decision. The run asked, got
      // no answer, and stopped — so nothing was chosen, no default was applied,
      // and saying otherwise would tell the user their work was confirmed when
      // it never was.
      ...(status === runStatus.UNANSWERED
        ? [
            "- This run did NOT fail, and it was NOT stopped by him: it needed something decided before it could go on, no answer arrived, so it stopped and wrote nothing further. Tell him plainly what it needed to know — the result text below names the question — and that nothing was chosen for him and no default was applied. Never say it went ahead, never say a recommendation was used, and do not present this as a decision that was made. Offer to run it again once he says which way he wants it.",
          ]
        : []),
      // Cost is recorded, not estimated — the figures below are what the
      // runtime itself reported.
      ...(usage?.cost_usd != null
        ? [
            `- If he asks what it cost or how long it took: this run was $${usage.cost_usd.toFixed(2)} over ${usage.num_turns ?? "an unrecorded number of"} turns. Do not volunteer this unless asked, and never estimate a figure of your own.`,
          ]
        : []),
      fenceUntrustedText(output || "(Claude returned no text output.)", "Claude's run result"),
      // Fenced on the same terms as the result text: a decision's wording comes
      // from the model, so it is content to read out, never directions to obey.
      ...(decisions?.length ? [fenceUntrustedText(renderDecisions(decisions), "the decisions this run deferred")] : []),
    ].join("\n");

    notifyIris(eventText);
  }

  // open-note-session design D3/5.1: work_on_note's own announcement path,
  // spoken AS WRITTEN — never the 1-3 sentence summary announceClaudeCompletion
  // asks for above. Scoped to this one verb rather than a general "don't
  // summarize" switch (design.md Risks): every other verb keeps the summary
  // instruction untouched.
  /**
   * @param {{ runId: string, task: string, status: string, output: string, usage?: { cost_usd: number|null, num_turns: number|null }|null }} params
   */
  function announceNoteWorkingResult({ runId, task, status, output, usage = null }) {
    // Same UI card path as announceClaudeCompletion — the card is correct for
    // any terminal status regardless of how the voice layer reads it.
    emitEvent({
      type: "claude_completion",
      run_id: runId,
      task,
      status,
      output,
      usage: usage ?? null,
      decisions: null,
    });

    // A run the user themselves stopped is not "here's your result" — same
    // rule as announceClaudeCompletion.
    if (status === runStatus.CANCELLED) return;

    const eventText = [
      "SYSTEM_EVENT_CLAUDE_COMPLETE",
      `run_id: ${runId}`,
      `status: ${status}`,
      `original_task: ${task}`,
      "instructions_to_iris:",
      `- The note-working session has a result for ${userDisplayName()}. Speak the text below EXACTLY AS WRITTEN — do NOT summarize, condense, or re-render it. This is a note reading or a report of an edit, and shortening it defeats the point of asking for it.`,
      "- If another conversation is in progress, pause it briefly first with something like: One moment, here's your note.",
      ...(status === runStatus.LIMITED
        ? [
            "- This run did NOT fail: it reached the turn or spend ceiling Iris puts on every run. Say so plainly before reading what it produced, and that the work it did complete still stands.",
          ]
        : []),
      fenceUntrustedText(output || "(The note-working session returned no text.)", "the note-working session's result, to be read aloud verbatim"),
    ].join("\n");

    notifyIris(eventText);
  }

  return {
    notifyIris,
    fenceUntrustedText,
    drainPendingAnnouncements,
    workspaceInfo,
    workspaceContextLine,
    announceWorkspaceUpdate,
    userDisplayName,
    announceClaudeCompletion,
    announceNoteWorkingResult,
    sendContextSupplement,
  };
}
