## REMOVED Requirements

### Requirement: Study is a third selectable pipeline role
**Reason**: The STUDY role is removed for the community release; Iris ships with chat-first defaults plus the PO → DEV pipeline only.
**Migration**: No runtime migration. Stale `agent_sessions.study`/`agent_models.study` keys in `~/.iris/claude-sessions.json` are ignored on load; a persisted active agent of `study` falls back to the default role. To recover the feature, revert to a pre-`v0.2.0` tag in git.

### Requirement: Division of labor — Gemini orchestrates, Study is librarian and fact-checker
**Reason**: Removed with the STUDY role; the `open-second-brain` dependency is dropped from the community release.
**Migration**: None; see the role-removal migration above.

### Requirement: Study runs as a stateful, isolated Agent SDK session
**Reason**: `electron/study-session.mjs` is deleted with the role.
**Migration**: None; see the role-removal migration above.

### Requirement: Write-note task records synthesized notes into the second brain
**Reason**: Removed with the STUDY role and its `open-second-brain` dependency.
**Migration**: Existing vault notes are untouched — they live in the user's vault, outside Iris.

### Requirement: Verify task fact-checks a note against source and web
**Reason**: Removed with the STUDY role.
**Migration**: None; see the role-removal migration above.

### Requirement: Study is exempt from OpenSpec and works in the workstream cwd
**Reason**: Removed with the STUDY role.
**Migration**: None; see the role-removal migration above.

### Requirement: Study may ask mid-turn and receives its model like PO
**Reason**: Removed with the STUDY role; the voice-decision relay reverts to PO-only (see the `voice-decision-relay` delta).
**Migration**: None; see the role-removal migration above.

### Requirement: Study session state is stored and cleaned up
**Reason**: Removed with the STUDY role.
**Migration**: Stale persisted `study` keys are ignored on load (no rewrite pass); `installIrisAgents` deletes a leftover `~/.claude/agents/iris-study.md` if present.
