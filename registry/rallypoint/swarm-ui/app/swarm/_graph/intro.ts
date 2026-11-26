/**
 * The graph's first-load reveal, as pure timing: which node starts moving when, and where it is
 * at any moment of the tween. The renderer settles the layout off-screen first, so every node's
 * end position is known; the intro then fans the nodes out from the hub along their radial
 * direction — the hub first, the sectors one after another clockwise from the top, then the work
 * and agents around each sector — and the edges draw on as their endpoints arrive.
 *
 * No DOM and nothing game-specific: nodes come in as ids, a role (hub, sector, other), the
 * sector they belong to, and their settled position.
 */

export type IntroNode = {
  id: string;
  role: 'hub' | 'sector' | 'other';
  /** For `other` nodes: the id of the sector node they belong to, if any. */
  sectorId?: string | null;
  /** Settled position, relative to the hub at (0, 0). */
  x: number;
  y: number;
};

export type IntroTiming = {
  /** When the node starts moving, in ms from the start of the intro. */
  delay: number;
  /** How long its tween lasts, in ms. */
  duration: number;
};

export type IntroPlan = {
  timing: Map<string, IntroTiming>;
  /** When the last node arrives at its place: nothing moves after this. */
  totalMs: number;
  /** When labels start fading in (they come last). */
  labelsAt: number;
  /** How long the camera pulls back from its opening zoom on the hub. */
  cameraMs: number;
};

export type IntroOptions = {
  /** Length of one node's tween. About 900–1400 ms for the full intro, ~300 for the short one. */
  nodeMs?: number;
  /** Gap between consecutive sectors around the ring. */
  sectorStaggerMs?: number;
  /** Gap between the hub starting and the first sector starting. */
  hubLeadMs?: number;
  /** Lag of a sector's satellites behind the sector itself. */
  satelliteLagMs?: number;
  /** Extra stagger per satellite, by distance from the hub, within one sector. */
  satelliteStaggerMs?: number;
};

/** The full first-load intro: about 1.1 s per node, sectors 80 ms apart. */
export const FULL_INTRO: Required<IntroOptions> = {
  nodeMs: 1100,
  sectorStaggerMs: 80,
  hubLeadMs: 120,
  satelliteLagMs: 160,
  satelliteStaggerMs: 25,
};

/** The shorter version for coming back to the page: everything in about half a second. */
export const SHORT_INTRO: Required<IntroOptions> = {
  nodeMs: 320,
  sectorStaggerMs: 14,
  hubLeadMs: 20,
  satelliteLagMs: 40,
  satelliteStaggerMs: 4,
};

/** Clockwise angle from 12 o'clock, in [0, 2π), with y pointing down (screen coordinates). */
export const clockAngle = (x: number, y: number): number => {
  const a = Math.atan2(y, x) + Math.PI / 2;
  const full = Math.PI * 2;
  return ((a % full) + full) % full;
};

/** At most this many satellites per sector get their own stagger step; the rest share the last. */
const MAX_STEPS = 8;

export const planIntro = (nodes: IntroNode[], options: IntroOptions = {}): IntroPlan => {
  const o = { ...FULL_INTRO, ...options };
  const timing = new Map<string, IntroTiming>();
  const at = (delay: number) => ({ delay, duration: o.nodeMs });

  for (const n of nodes) if (n.role === 'hub') timing.set(n.id, at(0));

  const sectors = nodes
    .filter((n) => n.role === 'sector')
    .sort((a, b) => clockAngle(a.x, a.y) - clockAngle(b.x, b.y) || a.id.localeCompare(b.id));
  const sectorDelay = new Map<string, number>();
  sectors.forEach((s, i) => {
    const d = o.hubLeadMs + i * o.sectorStaggerMs;
    sectorDelay.set(s.id, d);
    timing.set(s.id, at(d));
  });

  // Satellites follow their sector, nearest the hub first; unattached ones (gate roles around
  // the hub) go with the first sector.
  const bySector = new Map<string, IntroNode[]>();
  for (const n of nodes) {
    if (n.role !== 'other') continue;
    const key = n.sectorId && sectorDelay.has(n.sectorId) ? n.sectorId : '';
    const list = bySector.get(key) ?? [];
    list.push(n);
    bySector.set(key, list);
  }
  for (const [key, list] of bySector) {
    const base = (key ? sectorDelay.get(key)! : o.hubLeadMs) + o.satelliteLagMs;
    list
      .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.id.localeCompare(b.id))
      .forEach((n, i) =>
        timing.set(n.id, at(base + Math.min(i, MAX_STEPS) * o.satelliteStaggerMs)),
      );
  }

  let last = 0;
  for (const t of timing.values()) last = Math.max(last, t.delay + t.duration);
  return {
    timing,
    totalMs: last,
    labelsAt: Math.max(0, last - o.nodeMs * 0.45),
    cameraMs: last,
  };
};

/** Raw progress of one node's tween at `t` ms into the intro, in [0, 1]. Unknown nodes are done. */
export const introProgress = (timing: IntroTiming | undefined, t: number): number => {
  if (!timing) return 1;
  if (timing.duration <= 0) return t >= timing.delay ? 1 : 0;
  return Math.max(0, Math.min(1, (t - timing.delay) / timing.duration));
};

/** Ease-out cubic: fast out of the hub, settling softly at the end, never overshooting. */
export const easeOut = (p: number): number => 1 - (1 - Math.max(0, Math.min(1, p))) ** 3;

/**
 * Where a node is drawn at `t`: on the straight line from the hub to its settled spot (its
 * radial direction), with scale and opacity rising from 0.
 */
export const introPose = (
  node: Pick<IntroNode, 'x' | 'y'>,
  timing: IntroTiming | undefined,
  t: number,
): { x: number; y: number; scale: number; opacity: number } => {
  const e = easeOut(introProgress(timing, t));
  return {
    x: node.x * e,
    y: node.y * e,
    scale: 0.05 + 0.95 * e,
    opacity: Math.min(1, introProgress(timing, t) * 2.5),
  };
};

/** How much of an edge is drawn: it follows whichever endpoint arrives later. */
export const introEdge = (
  source: IntroTiming | undefined,
  target: IntroTiming | undefined,
  t: number,
): number => easeOut(Math.min(introProgress(source, t), introProgress(target, t)));

/** The opening zoom on the hub easing back to the fitted view (scale 1). */
export const introCamera = (plan: IntroPlan, t: number, from = 1.15): number =>
  1 + (from - 1) * (1 - easeOut(plan.cameraMs > 0 ? t / plan.cameraMs : 1));

/** Label opacity: labels fade in over the last stretch of the intro. */
export const introLabels = (plan: IntroPlan, t: number): number => {
  const span = plan.totalMs - plan.labelsAt;
  if (span <= 0) return t >= plan.totalMs ? 1 : 0;
  return Math.max(0, Math.min(1, (t - plan.labelsAt) / span));
};
