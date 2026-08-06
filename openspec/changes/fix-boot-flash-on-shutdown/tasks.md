## 1. The transition rule as pure logic

- [ ] 1.1 Add `src/lib/boot-gate.ts` exporting a pure function that takes the
      previous running flag and the incoming `{ running, connected }` pair and
      returns `{ introVisible, reportBootDone }`, modelled on the existing
      `src/lib/wake-gate.ts`
- [ ] 1.2 Encode the four transitions in it: rising edge of `running` while not
      connected ⇒ intro on; rising edge while already connected ⇒ intro stays off
      (instant resume); `connected` reached while the intro is on ⇒ intro off and
      `reportBootDone` true; any change with `running` unchanged ⇒ intro visibility
      carried through untouched
- [ ] 1.3 Add `src/lib/boot-gate.test.ts` with one case per scenario in the delta
      spec, driven as ordered transition sequences rather than single calls:
      cold start, reconnect (`connected → connecting → connected`, running never
      changes), shutdown in the real emit order (`gemini_status: offline` then
      `sidecar_status: running=false`), and instant resume
- [ ] 1.4 Assert in 1.3 that `reportBootDone` is true exactly once across a cold
      start, and never across the reconnect or shutdown sequences

## 2. Wire it into the renderer

- [ ] 2.1 Replace the derived `booting` expression at `src/App.tsx:828` with state
      driven by `boot-gate`, fed from a ref holding the previous `sidecarRunning`
- [ ] 2.2 Drive `<BootSequence visible={...}>` (`src/App.tsx:1856`) from that state
- [ ] 2.3 Fire `window.iris.notifyBootDone()` from the gate's `reportBootDone`
      rather than from the falling edge of `booting` (`src/App.tsx:829-835`), and
      remove `prevBootingRef` once nothing reads it
- [ ] 2.4 Check whether any other consumer reads `booting`; re-point or leave it
      derived for display only, but never for intro visibility or boot-done

## 3. Verify

- [ ] 3.1 Run the five gates: `npm run build`, `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check`
- [ ] 3.2 Manual: cold start plays the intro once, and it clears on connect
- [ ] 3.3 Manual: force a reconnect (drop Wi-Fi mid-session, or kill the connection)
      and confirm the intro does not appear while it re-dials
- [ ] 3.4 Manual: stop Iris and confirm no intro flash during teardown
- [ ] 3.5 Manual: stop Iris *while the intro is still playing*, and confirm no
      greeting is spoken on the way down (the armed-`GreetGate` case)
