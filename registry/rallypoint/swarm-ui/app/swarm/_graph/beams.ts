/**
 * Beam budget: which events earn a beam along the graph's edges, and how many can fly at once.
 *
 * Pure and renderer-agnostic, so the caps are unit-tested. The renderer asks `beamTier` whether an
 * event deserves a beam at all, then asks the gate (`createBeamGate`) whether it may fire one now.
 *
 * - Routine events (progress, game results, sessions, posts, plans) get no beam: a tick on the
 *   replay timeline and a soft pulse on their node at most.
 * - Beams are reserved for claims, pull requests opened, verdicts, merges and milestones. Merges,
 *   rungs cleared and rating jumps are the "big" tier: the only beams allowed a little glow.
 * - Coalescing: a beam for the same (sector, kind) within `windowMs` of the last one folds into it
 *   (its count grows) instead of firing again. A burst of 30 game results is one beam with a count.
 * - Hard caps: at most `maxInFlight` beams in flight and one new beam per `minGapMs`. Anything over
 *   a cap folds into the next beam that does fire.
 *
 * The same gate serves the live graph, the replay and the catch-up after a hidden tab.
 */

import type { SwarmEventKind } from './model';

export type BeamTier = 'none' | 'beam' | 'big';

/** Event kinds that may carry a beam. Everything else is routine. */
const BEAM_KINDS: ReadonlySet<SwarmEventKind> = new Set<SwarmEventKind>([
  'claim',
  'pr',
  'review',
  'reject',
  'merge',
  'milestone',
  'rating',
]);

/** The effects (from `effectOf`) that count as big moments. */
const BIG_EFFECTS = new Set(['merge', 'rung', 'rating']);

/**
 * Whether an event earns a beam. `effect` is the host's reading of it (`effectOf`); a rating with
 * no change is routine, as is a milestone the host chose not to mark.
 */
export const beamTier = (
  flow: { kind: SwarmEventKind; delta?: number | null },
  effect: string | null,
): BeamTier => {
  if (!BEAM_KINDS.has(flow.kind)) return 'none';
  if (flow.kind === 'rating' && !flow.delta) return 'none';
  if (effect && BIG_EFFECTS.has(effect)) return 'big';
  return 'beam';
};

export type BeamGateOptions = {
  /** Most beams in flight at once. Default 2. */
  maxInFlight?: number;
  /** Least time between two new beams, ms. Default 400. */
  minGapMs?: number;
  /** A beam for the same key within this long of the last folds into it, ms. Default 1500. */
  windowMs?: number;
};

export type BeamOffer =
  /** Fire a beam now; `id` reads its count later (it grows as events fold into it). */
  | { fire: true; id: number; count: number }
  /** No new beam: the event folded into beam `into` (null: into the next one to fire). */
  | { fire: false; into: number | null };

export type BeamGate = {
  /**
   * Offer one event: `key` is what coalesces (sector and kind), `durationMs` how long its beam
   * would fly. Returns whether to fire a beam and with what count.
   */
  offer: (key: string, now: number, durationMs: number) => BeamOffer;
  /** How many events beam `id` carries now (1 if it is unknown or long gone). */
  count: (id: number) => number;
  /** Beams in flight at `now`. */
  inFlight: (now: number) => number;
  /** Events waiting to fold into the next beam. */
  held: () => number;
  /** Forget everything (a replay seek, a new run). */
  reset: () => void;
};

type Beam = { id: number; key: string; start: number; end: number; count: number };

export const createBeamGate = (options: BeamGateOptions = {}): BeamGate => {
  const maxInFlight = options.maxInFlight ?? 2;
  const minGapMs = options.minGapMs ?? 400;
  const windowMs = options.windowMs ?? 1500;
  // Beams still in flight or within the coalescing window of their start. Tiny: at most a few.
  let beams: Beam[] = [];
  let lastFire = -Infinity;
  let held = 0;
  let nextId = 1;

  // A landed beam is kept a moment longer, so its count can still be read where it lands.
  const keep = (b: Beam, now: number) => b.end + 1000 > now || now - b.start < windowMs;
  const prune = (now: number) => {
    if (beams.some((b) => !keep(b, now))) beams = beams.filter((b) => keep(b, now));
  };
  const inFlight = (now: number) => {
    let n = 0;
    for (const b of beams) if (b.end > now) n++;
    return n;
  };

  return {
    offer(key, now, durationMs) {
      prune(now);
      // Coalesce: the newest beam with this key, still within the window, takes the event.
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i]!;
        if (b.key === key && now - b.start < windowMs) {
          b.count++;
          return { fire: false, into: b.id };
        }
      }
      if (inFlight(now) >= maxInFlight || now - lastFire < minGapMs) {
        held++;
        return { fire: false, into: null };
      }
      const beam: Beam = {
        id: nextId++,
        key,
        start: now,
        end: now + Math.max(0, durationMs),
        count: 1 + held,
      };
      held = 0;
      lastFire = now;
      beams.push(beam);
      return { fire: true, id: beam.id, count: beam.count };
    },
    count(id) {
      return beams.find((b) => b.id === id)?.count ?? 1;
    },
    inFlight,
    held: () => held,
    reset() {
      beams = [];
      held = 0;
      lastFire = -Infinity;
    },
  };
};
