## 1. The swap

- [x] 1.1 `src/components/HudShell.tsx:10` — replace `Network` with `Brain` in the `lucide-react` import, keeping the list's existing alphabetical order (it sits between `MicOff` and `PenTool` today, so `Brain` moves to the top of the block).
- [x] 1.2 `src/components/HudShell.tsx:400` — `<Network size={14} />` → `<Brain size={14} />`. Do **not** substitute `BrainCircuit`: the proposal records that it was considered and rejected because its strokes crowd at `size={14}` and the silhouette stops reading as a brain, which is the failure being fixed.
- [x] 1.3 Confirm the button's `title` (`:398`), `className` (`:396`), `onClick` and the `secondBrainAvailable` gate (`:394`) are byte-identical. The only diff in this file is the two lines above.
- [x] 1.4 `git grep -n "Network" -- src/components/HudShell.tsx` returns nothing, which also clears the name collision with `src/components/HoloBackdrop.tsx:43`'s internal `Network()` component. Confirm `HoloBackdrop.tsx` itself is unmodified.

## 2. Verification

- [x] 2.1 All five gates green: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`.
- [x] 2.2 `npm test` reports the same file/test counts as before the change. This change adds no test because there is no automated assertion of which glyph renders — a changed count means something other than the icon moved.
- [x] 2.3 `git diff --stat` lists exactly one file, `src/components/HudShell.tsx`, with two changed lines.
- [ ] 2.4 **Verified by eye, and this is the only route.** Run `npm start`, enter the Glass HUD with a vault present, and confirm the second-brain button shows a brain and that it still reads as a brain at its rendered size rather than as an indistinct shape. Nothing in the gates can check this; leaving it unticked is more honest than ticking it from a passing typecheck.

## 3. Out of scope

Ticked at the end to record that each was confirmed still absent, not that work was done.

- [x] 3.1 **No renderer identifier is renamed.** `hud.galaxyActive`, `toggleGalaxy`, the `HudLayer` member and the `GestureContext` member all still say `galaxy` after this change. That is `the-brain-is-the-feature-the-galaxy-is-the-view`'s job, and mixing it in here would cost this change its two-line diff.
- [x] 3.2 **No capability is split.** The requirement added here lands in `second-brain-galaxy-view` and moves to `second-brain-layer` when `a-hyphen-is-not-a-boundary` runs.
- [x] 3.3 **No other icon is reviewed.** The HUD's other buttons may or may not follow the same rule; auditing them is a separate question and would turn a two-line fix into a survey.
