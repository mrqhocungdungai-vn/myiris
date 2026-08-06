## 1. Lift the palette

- [ ] 1.1 In `src/styles/tokens.css`, set `--bg-0: #0b111c`, `--bg-1: #0e1522`,
      `--bg-2: #151d2c` — upstream's exact values from `ASHR12/iris@a4a81d4`, not
      re-derived approximations
- [ ] 1.2 Record the constraint in `tokens.css` beside those values: the `#0b111c`
      floor, why it is where it is (one code step at value 7 is ~14% relative
      brightness, at value 21 it is ~5%), and that anything added later — vignette,
      scrim, overlay — has to respect it. Nothing in the gate chain can catch a
      violation, so the comment is the only enforcement
- [ ] 1.3 Check the remaining surface tokens against the floor and note any that sit
      below it (`--panel-solid` and friends); fix or justify each rather than leaving
      it unexamined

## 2. Remove the window-scale near-black ramps

- [ ] 2.1 In `src/styles/deck.css:15-17`, replace
      `linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%)` with a flat fill,
      keeping the `radial-gradient(85% 70% ...)` layer above it intact
- [ ] 2.2 Delete `.hud-vignette` from `src/styles/base.css:86` and its mount at
      `src/App.tsx:1732`
- [ ] 2.3 Drop `:not(.hud-vignette)` from the promotion selector at
      `src/styles/deck.css:21` **and** from `src/styles/holo.css:9` together — that
      pair is specificity-matched on purpose (holo.css's own comment explains it),
      and editing one alone changes which rule wins the cascade for the backdrop
- [ ] 2.4 Update holo.css's header comment, which describes the adopted sheets as
      "upstream-verbatim" and names `hud-vignette` — both are stale after this change

## 3. Verify

- [ ] 3.1 Run the five gates: `npm run build`, `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check`
- [ ] 3.2 Confirm the dead-rule sweep still passes and its scope is unchanged — this
      change edits adopted sheets, which that check deliberately does not examine
- [ ] 3.3 Visual, and this is the real gate: run the app and look at large dark areas
      **in the dim states specifically**, which is where the accent washes stop
      masking the base. No plateaus, no hard edges
- [ ] 3.4 Visual: confirm the backdrop still sits behind the panel layer rather than
      on top of it — that is what task 2.3 puts at risk
- [ ] 3.5 Visual: check the deck, boot screen, overlays and note reader together, not
      just one surface. The palette moved under all of them
- [ ] 3.6 If banding survives 3.3, stop and record which surface still shows it
      rather than widening this change — `.hud-nebula`, `.hud-glow` and
      `deck.css:16`'s radial are the named follow-up candidates
