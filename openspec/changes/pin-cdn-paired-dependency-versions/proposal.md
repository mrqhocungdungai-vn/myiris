## Why

Two dependencies in this repo are consumed twice: once as an npm package, and once as a hardcoded CDN URL carrying a version number that must match the installed package. Both currently declare a caret range while the URL is fixed:

| Package | `package.json` | Hardcoded URL |
| --- | --- | --- |
| `@mediapipe/tasks-vision` | `^0.10.35` | `…/tasks-vision@0.10.35/wasm` (`src/hooks/useHandControl.ts:36`) |
| `onnxruntime-web` | `^1.27.0` | `…/onnxruntime-web@1.27.0/dist/` (`src/hooks/useWakeWord.ts:25`) |

`CLAUDE.md` already names this as a known footgun for MediaPipe — the package version and `WASM_URL` "must stay **equal**" — and a wrong value "silently breaks voice or gestures". The same pairing exists for the wake word's ONNX runtime, undocumented.

**This is a maintenance hazard, not a live bug**, and the proposal is deliberate about the difference: `package-lock.json` is committed and pins both to the exact versions above, and the documented install is `npm ci`, which installs from the lockfile. Nothing drifts today. The exposure is a future `npm update`, a `npm install <pkg>@latest`, or an automated dependency bump moving the lockfile while the hardcoded URL silently stays behind — producing a WASM/package mismatch whose failure mode is a runtime break in gesture control or wake word, not a build error. `npm run build` cannot catch it because the URL is an opaque string.

Doing this now, while the pairing has just been traced end to end, is cheaper than rediscovering it from a field report that "wake word stopped working after an update".

## What Changes

- **Pin both packages to exact versions** in `package.json` (drop the caret), so a routine `npm update` cannot move them independently of the URLs that name them.
- **Add a check that fails loudly when the pair diverges**, rather than relying on a comment being read at the right moment. Both call sites already carry a "keep these in sync" comment; a comment is what has to be *remembered*, and this replaces it with something that *fires*. The check must run under the repo's existing automated gates rather than introducing a new tool.
- **Document the ONNX runtime pairing in `CLAUDE.md`** alongside the MediaPipe one it currently describes, so the pinned-identifier list is complete.
- **Correct the `wake-sleep-voice` spec's CDN claim.** It currently states the wake-word pipeline uses "model assets bundled under `public/wakeword/` — no runtime CDN fetch". That is true of the three `.onnx` model files, but the `onnxruntime-web` WASM runtime *is* fetched from jsDelivr on first load. The requirement should say what actually happens, so a future reader does not plan against a guarantee the code never made.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `wake-sleep-voice`: the "On-device wake word while asleep" requirement's pinning and CDN-fetch language is corrected to describe actual behaviour — bundled model assets, CDN-fetched WASM runtime — and strengthened from "SHALL be pinned" to a pairing that is mechanically enforced.

## Impact

- **Code**: `package.json` (exact versions for both packages), a version-consistency check wired into the existing test run, and possibly small refactors at `src/hooks/useHandControl.ts:36` / `src/hooks/useWakeWord.ts:25` so the version is readable by that check rather than buried in a string literal.
- **Docs**: `CLAUDE.md`'s pinned-identifiers section; `openspec/specs/wake-sleep-voice/spec.md` on archive.
- **Dependencies**: no version is upgraded or downgraded by this change — it fixes the declarations to match what the lockfile already installs.
- **Risk**: low. If the check is written correctly it is a no-op today, because the versions currently agree; its value is entirely in the future.
- **Out of scope**: vendoring the WASM runtime locally to remove the CDN dependency altogether (a larger change with offline-first implications), and the `gesture_recognizer.task` model fetched from `storage.googleapis.com`, which carries no version in its URL and so cannot skew.
