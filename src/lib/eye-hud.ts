import type { EyePoint } from "../hooks/useEyeTracking";

// Pure presentation math for the eye HUD (design D11): ring geometry, the
// acquire easing, and the readout's hysteretic side-selection. No DOM and no
// MediaPipe, so all of it is testable under vitest's node environment — which
// is the only way anything in this capability can be tested at all.

/**
 * The overlay SVG's viewBox. Square units **by construction**: 400×300 matches
 * `.camera-frame`'s `aspect-ratio: 4 / 3` in both surfaces, so with the default
 * `preserveAspectRatio` a circle renders as a circle and text at its true
 * proportions. Deliberately NOT HandSkeleton's `0 0 100 100` +
 * `preserveAspectRatio="none"`, which is anisotropic and would stretch every
 * ring 33% wide (design D10).
 */
export const VIEW_W = 400;
export const VIEW_H = 300;

/** Reference radius the ring stack is drawn against; every layer is a fraction of it. */
export const RING_R = 100;

/**
 * How much larger than the true iris the ring is drawn (spec: "The ring is
 * legibly larger than the eye"). A first guess to re-tune by eye — apparent
 * iris size varies with the camera — but it must stay well above 1: at 1:1 the
 * ring is ~10px across on a typical webcam frame and its rotation is invisible.
 */
export const EYE_RING_BOOST = 5;

// ---------------------------------------------------------------------------
// Polar geometry. Angles are degrees clockwise from 12 o'clock, which is how
// the layer stack is described, and which matches SVG's y-down screen space.
// ---------------------------------------------------------------------------

function fmt(value: number): number {
  const rounded = Number(value.toFixed(3));
  // Normalize -0, which stringifies into path data as a bare "-0".
  return rounded === 0 ? 0 : rounded;
}

export function polarPoint(radius: number, deg: number): EyePoint {
  const rad = (deg * Math.PI) / 180;
  return { x: fmt(radius * Math.sin(rad)), y: fmt(-radius * Math.cos(rad)) };
}

/** A radial tick between two radii at one angle — the dial's graduations. */
export function tickLine(deg: number, innerRadius: number, outerRadius: number) {
  const inner = polarPoint(innerRadius, deg);
  const outer = polarPoint(outerRadius, deg);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
}

/** An open arc centered on the local origin. Negative `sweepDeg` runs counter-clockwise. */
export function arcPath(radius: number, startDeg: number, sweepDeg: number): string {
  const from = polarPoint(radius, startDeg);
  const to = polarPoint(radius, startDeg + sweepDeg);
  const largeArc = Math.abs(sweepDeg) > 180 ? 1 : 0;
  const clockwise = sweepDeg >= 0 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${fmt(radius)} ${fmt(radius)} 0 ${largeArc} ${clockwise} ${to.x} ${to.y}`;
}

/** A bracket flanking the ring: an arc closed at both ends by short inward ticks. */
export function wingPath(radius: number, centerDeg: number, spanDeg: number, depth: number): string {
  const start = centerDeg - spanDeg / 2;
  const end = centerDeg + spanDeg / 2;
  const innerStart = polarPoint(radius - depth, start);
  const outerStart = polarPoint(radius, start);
  const outerEnd = polarPoint(radius, end);
  const innerEnd = polarPoint(radius - depth, end);
  const largeArc = Math.abs(spanDeg) > 180 ? 1 : 0;
  return [
    `M ${innerStart.x} ${innerStart.y}`,
    `L ${outerStart.x} ${outerStart.y}`,
    `A ${fmt(radius)} ${fmt(radius)} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Ring interruptions. Both of these exist to satisfy one requirement, not for
// decoration: "Rotation is perceptible on every moving element". A rotationally
// uniform circle looks identical at every angle, so a layer without an
// asymmetric break contributes motion nobody can see. Both return dash arrays
// summing to exactly `pathLength`, so the pattern closes cleanly on a circle
// carrying that `pathLength` attribute — which also makes them radius-agnostic.
// ---------------------------------------------------------------------------

// Rounds for a readable attribute value, then puts the accumulated rounding
// drift back into the trailing gap — so the array sums to `pathLength`
// exactly and the pattern closes with no seam where the circle meets itself.
function closedDashArray(parts: number[], pathLength: number): string {
  const rounded = parts.map(fmt);
  const drift = pathLength - rounded.reduce((sum, part) => sum + part, 0);
  rounded[rounded.length - 1] += drift;
  return rounded.join(" ");
}

/** Evenly spaced dashes with one deliberately oversized gap as the asymmetry. */
export function dashPattern(pathLength: number, dashes: number, dashRatio: number, breakSpan: number): string {
  const unit = (pathLength - breakSpan) / dashes;
  const dash = unit * dashRatio;
  const gap = unit - dash;
  const parts: number[] = [];
  for (let i = 0; i < dashes; i++) {
    parts.push(dash, i === dashes - 1 ? gap + breakSpan : gap);
  }
  return closedDashArray(parts, pathLength);
}

/** Arcs of unequal length separated by equal gaps — the asymmetry is the arcs themselves. */
export function segmentRing(pathLength: number, weights: number[], gap: number): string {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const arcRoom = pathLength - gap * weights.length;
  return closedDashArray(
    weights.flatMap((weight) => [(weight / total) * arcRoom, gap]),
    pathLength,
  );
}

// ---------------------------------------------------------------------------
// Acquisition (design D8). These are multiplied into the scale/opacity the rAF
// loop already writes — never expressed as a CSS transition, which the loop
// would cancel on the very next frame.
// ---------------------------------------------------------------------------

export const ACQUIRE_MS = 320;
export const TETHER_MS = 170;
export const PANEL_MS = 150;
const ACQUIRE_FROM = 2.4;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Scale multiplier for the ring group, converging from ACQUIRE_FROM to 1.
 * easeOutBack overshoots past 1, so the ring settles with a beat instead of
 * stopping dead — the difference between "acquiring a target" and "a sprite
 * switching on".
 */
export function acquireScale(elapsedMs: number): number {
  if (elapsedMs >= ACQUIRE_MS) return 1;
  if (elapsedMs <= 0) return ACQUIRE_FROM;
  const p = elapsedMs / ACQUIRE_MS;
  const c1 = 1.70158;
  const eased = 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
  return ACQUIRE_FROM + (1 - ACQUIRE_FROM) * eased;
}

/** 0..1 draw-on for the tether, starting only once the ring has locked. */
export function tetherReveal(elapsedMs: number): number {
  return clamp01((elapsedMs - ACQUIRE_MS) / TETHER_MS);
}

/** 0..1 fade-in for the panel, starting only once the tether has landed. */
export function panelReveal(elapsedMs: number): number {
  return clamp01((elapsedMs - ACQUIRE_MS - TETHER_MS) / PANEL_MS);
}

/** How long the lock beat runs, after convergence completes. */
export const LOCK_MS = 400;
/** How much longer than its resting length the crosshair is drawn at the instant of lock. */
export const LOCK_STRETCH = 2;

/**
 * The lock beat: 1 at the moment convergence completes, decaying to 0 over
 * LOCK_MS. Multiplied into the crosshair's length and the core dot's opacity by
 * the same per-frame loop that positions everything else — never a CSS
 * transition, which that loop would cancel on the very next frame (design D8).
 *
 * Converging and then simply running forever leaves the acquisition without a
 * resolution: the instrument reads as having started rather than as having
 * acquired. This is the beat that closes it.
 *
 * Deliberately does NOT delay or overlap the tether and panel reveals above —
 * it runs alongside them, so the staged arrival the spec requires is unchanged.
 */
export function lockSettle(elapsedMs: number): number {
  if (elapsedMs <= ACQUIRE_MS) return 1;
  const p = clamp01((elapsedMs - ACQUIRE_MS) / LOCK_MS);
  // Cubic ease-out: most of the stretch is gone early, so the beat reads as a
  // snap rather than as a slow shrink.
  return (1 - p) ** 3;
}

/**
 * How many of a `ticks`-graduation dial are marked at this utilization.
 *
 * The ring's graduated element exists because the spec requires "a measurable
 * face rather than a set of plain circles" — and until now it measured nothing.
 * This is what it measures. An absent reading marks nothing rather than marking
 * zero, on the same rule as everywhere else.
 */
export function gaugeTicks(value: number | null, ticks: number): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(ticks, Math.round(clamp01(value) * ticks)));
}

// ---------------------------------------------------------------------------
// The readout's placement. All lengths are frame-normalized — x in frame
// widths, y in frame heights — which is the one coordinate system the SVG
// tether and the HTML panel can both agree on without either measuring the
// other (design D10).
// ---------------------------------------------------------------------------

export type ReadoutGeometry = {
  /** Gap between the eye and the panel's near edge, in frame widths. */
  offset: number;
  /** Panel width, in frame widths. */
  width: number;
  /** Panel height, in frame heights. */
  height: number;
  /** How far the panel's center sits above its eye, in frame heights. */
  rise: number;
};

/**
 * `height` is the one knob the panel's drawn box and its placement math both
 * read, so it is where the panel's content has to be paid for.
 *
 * The arithmetic. In the deck's camera dock the frame is ~256px, which puts
 * `font-size: clamp(6.5px, 3.1cqw, 10px)` in its fluid band — so font is
 * 0.031·frameW and the panel's height in em is a constant
 * `height × 0.75 / 0.031 = height × 24.19`.
 *
 * At the original 0.52 the box was 12.6em holding 13.83em of content — the
 * panel had been overflowing since it was built, silently, because
 * `overflow: hidden` clipped a decorative glyph line and nothing was lost. The
 * foot then took on real measurements, so it had to fit: 0.62 gave a 15.0em box
 * and 1.16em of slack, measured in the running app.
 *
 * The panel now carries a second reading — the token account
 * (token-accounting) — and the content has been re-totalled item by item
 * against the stylesheet:
 *
 *   header               1.51
 *   4 host rows       4×1.26 = 5.04
 *   1 meter              1.26   (the GPU meter is retired; see below)
 *   APP rule             0.90   (`.rule` carries an explicit height)
 *   2 engine rows     2×1.26 = 2.52
 *   cache line           1.10   (`.row.cache` carries an explicit height)
 *   foot                 1.26
 *   10 gaps          10×0.30 = 3.00
 *   padding                     1.40
 *   ------------------------------------
 *   content                    17.99em
 *
 * 0.78 gives an 18.87em box and **0.88em of slack**. The token block cost about
 * 5.7em; retiring the GPU meter paid ~1.56em of it (it was a segmented bar
 * restating the GPU percentage two rows above, while the network meter is
 * log-scaled across decades and stays), and the height carries the rest.
 *
 * THE COST, NAMED: `anchorY` is clamped to `[height/2, 1 - height/2]`, so the
 * panel's vertical travel falls from ±0.19 (at 0.62) to ±0.11 of the frame. It
 * tracks its eye less far. Accepted deliberately — the panel has been clamped
 * since it was built, and the alternative is a token block somewhere outside the
 * camera frame, which would be a second answer to one question.
 *
 * The line above is ARITHMETIC FROM THE STYLESHEET, not a reading taken in the
 * running app, and the two have disagreed here before. Verify it the same way
 * the 0.62 figure was verified: sum the CHILDREN, not the last child's offset —
 * `.foot` has `margin-top: auto`, so its offset tracks the box and will
 * cheerfully report the box back to you as the content. Check it against the
 * DECK dock, never the HUD's larger frame, which clamps at the 10px ceiling and
 * has slack that hides the problem.
 *
 * ANY future row costs ~1.56em (row plus gap) and must be paid for here.
 */
export const READOUT_GEOMETRY: ReadoutGeometry = {
  offset: 0.075,
  width: 0.3,
  height: 0.78,
  rise: -0.08,
};

export type ReadoutLayout = {
  /** Frame-normalized anchor: the panel's right edge, vertically centered. Both the tether's far end and the panel's own transform derive from exactly this. */
  anchorX: number;
  anchorY: number;
  /** 0..1 stagger, so the tether extends before the panel unfolds at its end. */
  tether: number;
  panel: number;
};

export function createReadoutLayout(): ReadoutLayout {
  return { anchorX: 0, anchorY: 0, tether: 0, panel: 0 };
}

/**
 * Resolves the layout for one frame, in place.
 *
 * The panel hangs LEFT of its eye and never anywhere else (spec: "The panel
 * stays on its eye's outward side, even when that clips it"). An earlier
 * version flipped it across its eye when the frame's left edge would clip it,
 * with hysteresis; both halves of that were wrong here. The near half is that
 * the flipped position is where the OTHER eye's ring is, so the two
 * instruments collided — the whole point of the asymmetric assignment is that
 * each eye owns its own half of the frame. The far half is that no deadband
 * makes a position that depends on head pose read as stable: the panel jumped
 * around. Clipping at the frame edge is the accepted cost, chosen deliberately
 * over both.
 *
 * Vertical placement still clamps — there is no second vertical position to
 * move to, so a clamp cannot oscillate and costs no legibility.
 */
export function resolveReadoutLayout(
  center: EyePoint,
  elapsedMs: number,
  layout: ReadoutLayout,
  geom: ReadoutGeometry = READOUT_GEOMETRY,
): ReadoutLayout {
  layout.anchorX = center.x - geom.offset;
  layout.anchorY = Math.max(geom.height / 2, Math.min(1 - geom.height / 2, center.y + geom.rise));
  layout.tether = tetherReveal(elapsedMs);
  layout.panel = panelReveal(elapsedMs);
  return layout;
}

/**
 * The tether: an origin dot at the eye, a diagonal run outward, a horizontal
 * run across, and a terminating tick at the panel's near (right) edge — in
 * viewBox units. `pathLength="1"` on the rendered path lets the draw-on be a
 * plain `stroke-dashoffset = 1 - tether`, with no length measurement anywhere.
 *
 * The knee sits inboard of the anchor — i.e. to its right, since the panel is
 * always left of the eye — so the run bends toward the panel rather than away.
 */
// ---------------------------------------------------------------------------
// The completed-run announcement (token-accounting / eye-tracking-hud). Same
// frame-normalized coordinate system as the readout above, and the same
// no-CSS-animation rule for exactly the reason EyeReticle.tsx:113-116 records:
// a transition or @keyframes on a transform this loop rewrites is cancelled by
// the next frame's write. The whole envelope is therefore pure functions of
// elapsed time here, testable, and tunable in one place.
//
// READOUT_GEOMETRY is NOT affected by any of this: the badge hangs outside the
// panel, on the other eye, so the panel's height budget is untouched.
// ---------------------------------------------------------------------------

/** Connector draw-on. */
export const ALERT_DRAW_MS = 250;
/** Badge unfold, staggered to begin only once the connector has landed. */
export const ALERT_UNFOLD_MS = 350;
/** How long the figure is held, fully drawn, before it begins to resolve. */
export const ALERT_HOLD_MS = 1900;
/** The resolve, during which the arrival runs in reverse. */
export const ALERT_RESOLVE_MS = 1000;
/** Badge fold, within the resolve — the reverse of the stagger on the way in. */
export const ALERT_FOLD_MS = 600;
/** End to end. After this the announcement is gone and leaves nothing behind. */
export const ALERT_TOTAL_MS = ALERT_DRAW_MS + ALERT_UNFOLD_MS + ALERT_HOLD_MS + ALERT_RESOLVE_MS;

const ALERT_RESOLVE_AT = ALERT_DRAW_MS + ALERT_UNFOLD_MS + ALERT_HOLD_MS;

/** 0..1 draw-on/retract for the connector, across the whole envelope. */
export function alertConnector(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs < ALERT_DRAW_MS) return elapsedMs / ALERT_DRAW_MS;
  if (elapsedMs < ALERT_RESOLVE_AT) return 1;
  if (elapsedMs < ALERT_TOTAL_MS) return 1 - (elapsedMs - ALERT_RESOLVE_AT) / ALERT_RESOLVE_MS;
  return 0;
}

/** 0..1 unfold/fold for the badge, staggered after the connector in both directions. */
export function alertBadge(elapsedMs: number): number {
  if (elapsedMs <= ALERT_DRAW_MS) return 0;
  if (elapsedMs < ALERT_DRAW_MS + ALERT_UNFOLD_MS) return (elapsedMs - ALERT_DRAW_MS) / ALERT_UNFOLD_MS;
  if (elapsedMs < ALERT_RESOLVE_AT) return 1;
  if (elapsedMs < ALERT_RESOLVE_AT + ALERT_FOLD_MS) return 1 - (elapsedMs - ALERT_RESOLVE_AT) / ALERT_FOLD_MS;
  return 0;
}

export type AlertGeometry = {
  /** Gap between the eye and the badge's near (left) edge, in frame widths. */
  offset: number;
  /** Badge width, in frame widths. */
  width: number;
  /** How far the badge's center sits above its eye, in frame heights. */
  rise: number;
};

/**
 * Smaller than the panel in every dimension, and that is the point: this is a
 * momentary mark, not a second readout. The rule fixing one persistent element
 * per eye is not broken by it, and it must not drift into something that looks
 * like it could be.
 */
export const ALERT_GEOMETRY: AlertGeometry = {
  offset: 0.07,
  width: 0.2,
  rise: -0.1,
};

/**
 * The announcement's whole runtime state, in one object shared between the
 * component that resolves it (EyeReticle, which owns the frame) and the one
 * that draws the badge — the same arrangement ReadoutLayout already uses, so
 * neither component measures the other.
 *
 * `shownAt` is a `performance.now()` stamp; `at` is the LEDGER timestamp the
 * envelope belongs to, kept so a second completion can be recognized as a
 * different event rather than as the same one.
 */
export type AlertState = {
  shownAt: number | null;
  at: number | null;
  tokens: number | null;
  /** Frame-normalized: the badge's LEFT edge, vertically centered. */
  anchorX: number;
  anchorY: number;
  connector: number;
  badge: number;
};

export function createAlertState(): AlertState {
  return { shownAt: null, at: null, tokens: null, anchorX: 0, anchorY: 0, connector: 0, badge: 0 };
}

/**
 * Resolves the announcement for one frame, in place.
 *
 * The badge hangs RIGHT of the ring eye and never anywhere else — outward, on
 * the side of the frame that eye appears on, mirroring the panel's leftward
 * rule. The two instruments therefore stay in their own halves of the frame and
 * cannot collide, whatever the head does.
 *
 * `anchorX` is the badge's LEFT edge and is always strictly right of the eye by
 * `offset`, so no part of the badge can cover the eye at any head pose. The
 * frame's right edge CLIPS it rather than moving it, for the reason already
 * recorded for the panel: an element that changes side mid-appearance reads as
 * malfunctioning, and relocation while the user turns their head is worse than
 * truncation.
 *
 * Vertical placement clamps, as the panel's does — there is no second vertical
 * position to move to, so a clamp cannot oscillate. Clamping moves only `y`, so
 * it cannot bring the badge back across the eye.
 */
export function resolveAlertLayout(
  center: EyePoint,
  elapsedMs: number,
  state: AlertState,
  geom: AlertGeometry = ALERT_GEOMETRY,
): AlertState {
  state.anchorX = center.x + geom.offset;
  state.anchorY = Math.max(0.02, Math.min(0.98, center.y + geom.rise));
  state.connector = alertConnector(elapsedMs);
  state.badge = alertBadge(elapsedMs);
  return state;
}

/**
 * The announcement's connector: an origin dot at the eye, a run outward, and a
 * terminating tick at the badge's near (left) edge — in viewBox units, and
 * carrying `pathLength="1"` on the rendered path so the draw-on is a plain
 * `stroke-dashoffset = 1 - connector` with no length measurement anywhere.
 *
 * The knee sits inboard of the anchor — i.e. to its LEFT, since the badge is
 * always right of the eye — so the run bends toward the badge rather than away.
 * The mirror of tetherPath, deliberately: this borrows the arrival idiom the
 * tether already established rather than inventing a second one.
 */
export function alertPath(center: EyePoint, state: AlertState, elbow = 0.04): string {
  const ex = center.x * VIEW_W;
  const ey = center.y * VIEW_H;
  const ax = state.anchorX * VIEW_W;
  const ay = state.anchorY * VIEW_H;
  const kneeX = ax - elbow * VIEW_W;
  return `M ${fmt(ex)} ${fmt(ey)} L ${fmt(kneeX)} ${fmt(ay)} L ${fmt(ax)} ${fmt(ay)}`;
}

export function tetherPath(center: EyePoint, layout: ReadoutLayout, elbow = 0.045): string {
  const ex = center.x * VIEW_W;
  const ey = center.y * VIEW_H;
  const ax = layout.anchorX * VIEW_W;
  const ay = layout.anchorY * VIEW_H;
  const kneeX = ax + elbow * VIEW_W;
  return `M ${fmt(ex)} ${fmt(ey)} L ${fmt(kneeX)} ${fmt(ay)} L ${fmt(ax)} ${fmt(ay)}`;
}
