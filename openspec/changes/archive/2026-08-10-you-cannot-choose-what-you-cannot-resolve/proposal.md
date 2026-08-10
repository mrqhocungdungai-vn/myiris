## Why

Aiming at a note inside a dense cluster, from outside the cluster, made the
target flicker through its neighbours.

The movement causing it is real: an unsteady hand travels tens of pixels. At
that distance so do the gaps between neighbouring notes, so the sight sweeps
across a dozen of them, each briefly nearest. No amount of smoothing fixes it,
because there is nothing wrong with the input — what is missing is that the user
cannot be aiming at a particular note when they cannot resolve one from its
neighbours.

The existing defences are margins against NOISE: a 30px incumbent bias and a
28px occlusion rule, which together already make a challenger within roughly
58px lose. They do not express intent, and the first threshold I tried (64px)
would have changed almost nothing while looking like a fix. Cutting the wire
caught it — the test passed with the rule deleted.

## What Changes

**A challenger must be at least 120px from the incumbent on screen before it may
take the target at all**, separately from being nearer the sight.

The measure is screen separation because that is exactly the question being
asked — could this have been aimed at? — and because it scales itself. The same
two notes that are 20px apart from across the vault are 200px apart once the
user has flown in among them. So "get closer to choose within a cluster" is not
a rule anyone has to be told: it is the only thing that makes the neighbours
choosable, and it is what the user proposed.

A note plainly somewhere else on screen is still taken immediately.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- `src/lib/galaxy-anchor.ts`
