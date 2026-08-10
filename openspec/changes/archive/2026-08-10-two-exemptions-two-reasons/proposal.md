## Why

A false justification I wrote into the living spec, caught by the user:

> Aiming and the dwell SHALL remain available, because they are how a lock is
> acquired and how a note is opened.

One reason offered for two exemptions that have nothing to do with each other,
and the reason is **false for the dwell**. Gating the dwell on a lock would not
make it unreachable — you would aim a palm at one note to lock, then point at
another to open it. Perfectly reachable, and still wrong, but not for the
reason given.

The rule is only as good as why it holds. A reader inheriting this would think
the dwell is exempt for a circularity that does not exist, and would gate it
the moment that circularity was designed away.

## What Changes

Two exemptions, two reasons, stated separately.

**Aiming** is exempt because gating it is genuinely circular: aiming is the only
thing that creates a lock, so requiring a lock to aim means no lock can ever
exist.

**The dwell and the `Victory` reveal** are exempt because they do not move the
camera. They act on the note they are pointed at, so they never need a basis to
act *around* — the defect the lock requirement exists to prevent, a drive
choosing a pivot the user did not pick, cannot arise for a gesture that picks
its own subject by pointing at it.

Also recorded: the reveal takes **one** `Victory` hand, which is what it has
always done. Two add nothing, and nothing should ask for them.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- No code change — the code was right; the reason written beside it was not
