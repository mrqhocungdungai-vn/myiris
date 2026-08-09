## 1. An interruption stops the speech, not the work

- [x] 1.1 `live-messages.mjs` no longer reports interruptions to the run layer; the seam through `wiring-live` and `wiring` is removed rather than left unused
- [x] 1.2 Tests: an interruption still returns the app to listening and still flushes what was said, and reaches no cancellation path

## 2. Canvas mode is announced once

- [x] 2.1 `capabilities/canvas.mjs` announces on the first engagement only, sticky like `canvasEngaged`
- [x] 2.2 Test rewritten from "announces again when reopened" to "says it once, however many times the panel activates", with the measurement that settled it

## 3. Gates

- [x] 3.1 build / test / lint / scan:secrets / spec:check — green, 1734 tests
