/**
 * Nodes arriving on, leaving and moving across the live graph, as pure timing. The same easing
 * family as the radial intro (`intro.ts`), so the intro, arrivals, departures and moves read as
 * one system. Nothing here is physics: the layout engine (`layout.ts`) decides where a node
 * stands, and these tweens are the only way it gets there (#221). Every one, stagger included,
 * is over within `TRANSITION_MS`.
 *
 * Arriving: a node appears at its place, at 40% size and transparent, and grows and fades in
 * with an ease-out; its label follows just after the circle and its edges draw on from the
 * parent end.
 *
 * Leaving: the node's opacity goes to 0 and its radius to 60% in place, with an ease-in-out; its
 * label fades a little ahead of the circle, its edges thin and fade at the circle's rate. Only
 * then does it leave the graph. Nothing else moves into the room it leaves.
 *
 * Moving (a node the layout re-placed, or a resize re-fitting the canvas): a straight line from
 * where it stands to its new place with one ease-out cubic, so its distance to the target only
 * ever shrinks: no overshoot, no settling.
 */

import { easeOut } from './intro';

/** The longest any arrival, departure or move takes, its stagger included. */
export const TRANSITION_MS = 700;

export const ARRIVAL = {
  durationMs: 560,
  staggerMs: 35,
  /** Stagger steps at most; a big burst shares the last one. */
  maxSteps: 4,
  startScale: 0.4,
  /** The label starts once the circle is this far along. */
  labelLag: 0.25,
} as const;

export const DEPARTURE = {
  durationMs: 600,
  staggerMs: 25,
  maxSteps: 4,
  endScale: 0.6,
  /** The label is gone by this point of the circle's fade. */
  labelLead: 0.7,
} as const;

export const MOVE = {
  durationMs: 500,
} as const;

const clamp = (p: number) => Math.max(0, Math.min(1, p));

/** Ease-in-out cubic: a soft start and a soft landing. */
export const easeInOut = (p: number): number => {
  const x = clamp(p);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** When the i-th of a batch starts, in ms after the batch. */
export const staggerAt = (i: number, step: number, maxSteps: number) =>
  Math.min(i, maxSteps) * step;

/** Raw progress `t` ms after a tween that starts at `delay` and lasts `duration`. */
export const progressAt = (t: number, delay: number, duration: number) =>
  duration <= 0 ? (t >= delay ? 1 : 0) : clamp((t - delay) / duration);

export type Pose = {
  scale: number;
  opacity: number;
  label: number;
  /** Edge visibility: how much is drawn (arriving) or its opacity and width factor (leaving). */
  edge: number;
};

export const arrivalPose = (p: number): Pose => {
  const e = easeOut(p);
  return {
    scale: ARRIVAL.startScale + (1 - ARRIVAL.startScale) * e,
    opacity: e,
    label: easeOut((clamp(p) - ARRIVAL.labelLag) / (1 - ARRIVAL.labelLag)),
    edge: e,
  };
};

export const departurePose = (p: number): Pose => {
  const e = easeInOut(p);
  return {
    scale: 1 - (1 - DEPARTURE.endScale) * e,
    opacity: 1 - e,
    label: 1 - easeInOut(clamp(p) / DEPARTURE.labelLead),
    edge: 1 - e,
  };
};

/** A move `p` of the way along (0 → 1): how far from start to target, never past it. */
export const moveAt = (p: number): number => easeOut(p);

/** Where a moving node stands: on the straight line from `from` to `to`. */
export const movePoint = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  p: number,
): { x: number; y: number } => {
  const k = moveAt(p);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
};
