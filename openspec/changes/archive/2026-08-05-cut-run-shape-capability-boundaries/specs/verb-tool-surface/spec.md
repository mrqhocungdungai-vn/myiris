## REMOVED Requirements

### Requirement: Verbs that continue one conversation share one live session
**Reason**: Moved to `stateful-verb-session`, unchanged in substance. The rule specifies
what a shared resident session does — context carrying across a medium switch, and the
model coupling that follows — which is session mechanics, not part of what a verb is.
`verb-tool-surface` keeps the declaration side: statefulness is fixed per verb, and the
registry is where a verb's session key is declared.

**Migration**: None. Spec-only relocation; no code, stored state, or behavior changes.
The requirement and both of its scenarios appear verbatim in
`openspec/specs/stateful-verb-session/spec.md` after this change.
