import { describe, it, expect } from "vitest";
import { revealStep, INITIAL_REVEAL_LATCH, type RevealLatch } from "./reveal-latch";

/** Drives a panel through a sequence of (active, userToggledTo) steps. */
function run(steps: Array<{ active: boolean; setOpen?: boolean }>) {
  let latch: RevealLatch = INITIAL_REVEAL_LATCH;
  let open = false;
  const seen: boolean[] = [];
  for (const step of steps) {
    if (step.setOpen !== undefined) open = step.setOpen;
    const result = revealStep(latch, step.active, open);
    latch = result.latch;
    if (result.open !== null) open = result.open;
    seen.push(open);
  }
  return { open, seen, latch };
}

describe("revealStep", () => {
  it("forces the panel open when the reveal begins", () => {
    expect(run([{ active: true }]).open).toBe(true);
  });

  // Someone who had the panel open before must not find it shut afterwards.
  it("restores what was showing just before the reveal", () => {
    expect(run([{ active: false, setOpen: true }, { active: true }, { active: false }]).open).toBe(true);
    expect(run([{ active: false, setOpen: false }, { active: true }, { active: false }]).open).toBe(false);
  });

  // The rule that keeps it from fighting the user.
  it("writes nothing while active is unchanged", () => {
    const latch: RevealLatch = { revealed: true, prior: false };
    expect(revealStep(latch, true, true).open).toBeNull();
    expect(revealStep(INITIAL_REVEAL_LATCH, false, true).open).toBeNull();
  });

  it("respects a manual close during the reveal, and still restores after", () => {
    // Open before, revealed, user closes it by hand, then the reveal ends.
    const result = run([
      { active: false, setOpen: true },
      { active: true },
      { active: true, setOpen: false },
      { active: false },
    ]);
    // The user's manual close was not re-forced on step 3...
    expect(result.seen[2]).toBe(false);
    // ...and the pre-reveal value is what comes back.
    expect(result.open).toBe(true);
  });

  // Without this, a second engage records the forced-open `true` and the panel
  // can never be restored to its real prior value.
  it("does not overwrite the recorded value on a repeated engage", () => {
    let latch = INITIAL_REVEAL_LATCH;
    let step = revealStep(latch, true, false);
    latch = step.latch;
    expect(latch.prior).toBe(false);
    step = revealStep(latch, true, true);
    latch = step.latch;
    expect(latch.prior).toBe(false);
    expect(revealStep(latch, false, true).open).toBe(false);
  });

  it("survives repeated reveal cycles", () => {
    const result = run([
      { active: false, setOpen: true },
      { active: true },
      { active: false },
      { active: true },
      { active: false },
    ]);
    expect(result.open).toBe(true);
  });
});
