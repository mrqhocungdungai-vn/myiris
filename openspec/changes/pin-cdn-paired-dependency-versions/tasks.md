## 1. Make the versions readable

- [ ] 1.1 Lift the MediaPipe WASM version out of the URL literal at `src/hooks/useHandControl.ts:36` into a named constant used to build `WASM_URL`, so a test can read the version without regexing a string
- [ ] 1.2 Do the same for the ORT WASM version at `src/hooks/useWakeWord.ts:25` (`ort.env.wasm.wasmPaths`)
- [ ] 1.3 Make both constants importable from a node-environment test — the importing module must not pull in Web Audio, MediaPipe, or `onnxruntime-web` at import time, per the test-harness spec's "no runtime prerequisites" rule. Extract to a tiny shared module if importing the hooks would violate that

## 2. Pin the declarations

- [ ] 2.1 Change `package.json` to exact versions: `"@mediapipe/tasks-vision": "0.10.35"` and `"onnxruntime-web": "1.27.0"` (design D1)
- [ ] 2.2 Run `npm ci` and confirm `package-lock.json` is unchanged — these are the versions already locked, so this must be a no-op on `node_modules`

## 3. Enforce the pairing

- [ ] 3.1 Add a test that reads `package.json` and asserts each CDN-paired dependency's declared version equals the constant from group 1, naming the offending pair on failure (design D2)
- [ ] 3.2 Prove the guard actually guards: temporarily change one version, confirm `npm test` fails with the intended message, then revert
- [ ] 3.3 Confirm the test runs under the existing `npm test` with no network, no Electron, and no API keys

## 4. Docs and spec

- [ ] 4.1 Add the `onnxruntime-web` / ORT WASM URL pairing to `CLAUDE.md`'s pinned-identifiers section, beside the MediaPipe entry it already documents, and note that the pairing is now test-enforced
- [ ] 4.2 Replace the "keep this in sync" comments at both call sites with a pointer to the enforcing test — a comment that names the guard is useful; one that asks to be remembered is what failed
- [ ] 4.3 Verify `npm run build` and `npm test` both pass

## 5. Archive

- [ ] 5.1 **Archive `harden-wake-word-detection` first.** Both changes MODIFY the same `wake-sleep-voice` requirement, and this change's delta is written against the post-harden text — see the header comment in `specs/wake-sleep-voice/spec.md`
- [ ] 5.2 Re-read `openspec/specs/wake-sleep-voice/spec.md` after that archive and confirm the delta here still applies cleanly; rebase it if the harden change landed differently than drafted
- [ ] 5.3 Archive this change so the corrected CDN-fetch language and the pinning requirement reach the living spec
