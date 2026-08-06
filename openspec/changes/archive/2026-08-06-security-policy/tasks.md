## 1. Open a channel that actually exists

- [x] 1.1 **Enable private vulnerability reporting** on `mrqhocungdungai-vn/myiris`. It
      is currently off. This is a repo-settings action and it blocks the rest — a
      `SECURITY.md` linking a disabled reporting path is worse than none
- [x] 1.2 Fix `package.json`'s `bugs.url`, which points at an issue tracker that is
      disabled on this repo. Either enable Issues or point it somewhere real
- [x] 1.3 State what a reporter can expect: acknowledgement timeframe, and that there are
      no bounties. Do not promise a response time that will not be met
- [x] 1.4 State which versions are covered. There are no tags and no releases, so say
      plainly that `main` is the only supported line rather than inventing a version
      table

## 2. State the boundaries accurately

- [x] 2.1 Permission posture: `bypassPermissions` is the intentional default for the
      headless worker, and the `PreToolUse` denylist is **a guard against accidents, not
      a sandbox**. Describe it by its actual contents — three regexes, applied only to
      `Bash`: `rm -rf` rooted at `/`, `~`, or `$HOME` (relative paths deliberately not
      matched), `git push --force`, and `git reset --hard origin/…`. Nothing constrains
      Write, Edit, Read, or any other tool
- [x] 2.2 Honour the standing instruction in `electron/run-hooks.mjs`: a determined or
      confused model can reach the same effect by other means (a script, a renamed
      binary, a different tool), and **Iris must not claim otherwise anywhere in its
      interface or its docs**. This document is covered by that sentence
- [x] 2.3 Review gate — state the shape, not just the existence. Give the per-verb park
      behaviour (always / on-open-only / never) or state the rule, and say that verbs
      which never park still run under `bypassPermissions` with Bash. Use "declared
      **property**", not "declared label"; `label` is the display name and the park
      decision reads a different field
- [x] 2.4 Say the gate is user-configurable and can be turned off entirely
      (`IRIS_PROMPT_REVIEW`, modes `never` / `always` / `verb`) — so it must not be
      described as unconditional. Then state the guarantee that *is* strong and is
      currently missing from the draft: **the voice model has no tool that reaches this
      flag.** Only the UI control and the startup default set it, and an unrecognised
      value is refused rather than coerced, so a typo cannot quietly disarm it
- [x] 2.5 Spoken audio is untrusted input, and it reaches an agent that executes tools.
      Say it directly
- [x] 2.6 Credentials: `GEMINI_API_KEY` is always withheld from the worker;
      `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed when a subscription
      token is present, and `ANTHROPIC_API_KEY` means metered billing only when there is
      no subscription token. Note the `bypassPermissions` env override applies to
      one-shot runs only — the resident session hardcodes it
- [x] 2.7 `~/.claude` is never read or written, and it takes **both** `settingSources`
      excluding the user scope and a pinned `CLAUDE_CONFIG_DIR`, because transcripts,
      `.claude.json`, and auto-memory are read regardless of `settingSources`
- [x] 2.8 Renderer: the production CSP in full, and the fact that `'unsafe-inline'`
      appears only in the dev policy. `connect-src 'self'` is a genuinely strong claim
      worth making explicitly — Gemini Live runs in the main process, not the renderer.
      Note honestly that the CSP is delivered as a `<meta http-equiv>` rather than a
      response header, so `frame-ancestors` and `sandbox` are not enforceable through it
- [x] 2.9 Secret scanning is a gate that fails closed without `gitleaks`, with
      `IRIS_SKIP_HOOKS=1` as the announced bypass

## 3. State the non-goals

- [x] 3.1 List what Iris does not defend against: an agent running with
      `bypassPermissions` in the user's own project, the denylist not being a sandbox, an
      unsigned application bundle, and a local user who already has the machine
- [x] 3.2 Add `IRIS_ALLOW_ANY_PLATFORM=1`, which bypasses the macOS-only admission check
      and puts the app in untested territory
- [x] 3.3 Add the `~/.claude` isolation as a non-goal too. Pinning `CLAUDE_CONFIG_DIR`
      and excluding the user scope is **configuration scoping, not containment** — a run
      under `bypassPermissions` can still reach those paths through Bash like any other.
      Without this line a reader takes it for a sandbox, which is the same misreading
      task 2.1 guards against for the denylist
- [x] 3.4 Address prompt injection from **non-audio** sources — file content, tool
      output, web results all re-enter the agent's context, and the verbs that read that
      material are among the ones that never park. Name it in scope or name it a
      non-goal; leaving it unstated is the ambiguity this section exists to remove
- [x] 3.5 Say what *would* be a vulnerability: a path that dispatches work without
      passing the review gate when the gate is on, a credential reaching a process that
      should not see it, renderer code loading from a network origin, or the review mode
      being changed by anything other than the UI control

## 4. Wire it up

- [x] 4.1 Link `SECURITY.md` from README, which currently contains no security section
- [x] 4.2 Link to the capability specs rather than restating them, so the policy cannot
      drift from the behaviour it describes

## 5. Verify

- [x] 5.1 Run the five gates. `spec:check` scans only `openspec/specs/` and will pass
      trivially — it proves nothing about this change
- [x] 5.2 Re-read every claim against the source it cites and confirm the document
      promises nothing stronger than what is actually enforced. Overstating a guarantee
      is the specific failure mode this change can introduce, and the review gate's
      scope is where it is most likely to happen
- [x] 5.3 Confirm the reporting link works before publishing — task 1.1 must be done, not
      merely planned
- [x] 5.4 Confirm no real credential, path, or internal address leaked into the document
