/**
 * The positioning engine (#221): where every node of the swarm graph stands, computed off-screen
 * and to convergence before anything is drawn. The renderer never runs physics on screen; it
 * only tweens each node from where it is to the place this module gives it.
 *
 * The engine is d3-force's model run headless to rest (see `layoutGraph`), chosen over
 * cytoscape-fcose, WebCola and ELK on stability under incremental change, determinism, speed and
 * bundle size (the numbers are in the pull request for #221). Two rules give the stability,
 * whatever the solver:
 *
 * - **Sectors and the hub are fixed** (`fixed`): the ring, set by the canvas, never by the data.
 * - **Every node already laid out is pinned** (`pinned`): only new or re-placed nodes are free.
 *   A node arriving or leaving anywhere moves nothing else; pinned nodes never give way to
 *   each other. (Growth has room reserved: a sector is laid out at its largest size.) Only a
 *   re-fit (`settle`, a resized canvas) lets a pinned node that overlaps another move out, by
 *   exactly the overlap and no further.
 *
 * Deterministic: the same nodes, links and pins give the same positions (a seeded random source,
 * start points derived from ids, no clock). Pure: no DOM, so it can run in a test or a worker.
 */

export type LayoutPoint = { x: number; y: number };

export type LayoutNode = {
  id: string;
  /** Room the node keeps clear around its centre: its body, its ring and a margin. */
  r: number;
  /** Where its sector pulls it (a free node only), and how hard. */
  anchor: LayoutPoint;
  anchorStrength: number;
  /** Many-body strength (negative repels). */
  charge: number;
  /** Held here whatever happens: the sectors on their ring, the hub at the centre. */
  fixed?: LayoutPoint;
  /** Already laid out: it stays exactly here (unless `settle` must clear an overlap). */
  pinned?: LayoutPoint;
  /** Where a free node starts (its last place, for a re-placed node). Default: beside `parent`. */
  start?: LayoutPoint;
  /** What a new node is placed beside: its sector, its work item. */
  parent?: string;
  /** Half the box it must stay inside, centred on the origin. */
  limit: LayoutPoint;
};

export type LayoutLink = { source: string; target: string; distance: number; strength: number };

export type LayoutResult = {
  positions: Map<string, LayoutPoint>;
  /** Nodes the solver placed (neither fixed nor pinned). */
  free: number;
  /** Solver ticks it took to rest (0 when nothing was free). */
  ticks: number;
};

export type LayoutOptions = {
  /** Seed of the random source that splits coincident nodes. */
  seed?: number;
  /** Most solver ticks; it stops earlier once the free nodes rest. */
  maxTicks?: number;
  /**
   * Clear overlaps between held nodes too (the smaller pinned one gives way by the overlap).
   * For a re-fit after a resize; never for a data update, so nothing pinned moves then.
   */
  settle?: boolean;
};

type Body = { node: LayoutNode; mobile: boolean; x: number; y: number };

/** FNV-1a: a stable number per id, for start angles. */
export const hashId = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A small seeded generator (an LCG), so the solver's jiggle is reproducible. */
const lcg = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296;
};

/** Where a new node starts: just outside its parent, turned towards its anchor. */
export const besideParent = (
  parent: LayoutPoint & { r: number },
  anchor: LayoutPoint,
  id: string,
  r: number,
): LayoutPoint => {
  let dx = anchor.x - parent.x;
  let dy = anchor.y - parent.y;
  if (Math.hypot(dx, dy) < 1) {
    // No pull away from the parent: head outward, away from the centre.
    dx = parent.x || 1;
    dy = parent.y;
  }
  const spin = ((hashId(id) % 1000) / 1000 - 0.5) * 1.6;
  const a = Math.atan2(dy, dx) + spin;
  const d = parent.r + r + 6;
  return { x: parent.x + Math.cos(a) * d, y: parent.y + Math.sin(a) * d };
};

const clampTo = (b: Body) => {
  if (b.node.fixed) return;
  const { x, y } = b.node.limit;
  b.x = Math.max(-x, Math.min(x, b.x));
  b.y = Math.max(-y, Math.min(y, b.y));
};

/**
 * Push overlapping nodes apart by exactly their overlap. Fixed nodes never move; free nodes give
 * way first; with `settle`, of two held nodes the smaller pinned one gives way. A few sweeps over
 * all pairs: the graph has a few hundred nodes.
 */
export const separate = (bodies: Body[], settle = false, sweeps = 24) => {
  for (let s = 0; s < sweeps; s++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        const min = a.node.r + b.node.r;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= min - 0.01) continue;
        // Who gives way: free nodes first; between two held ones, the smaller pinned one.
        let wa = a.mobile ? 1 : 0;
        let wb = b.mobile ? 1 : 0;
        if (!wa && !wb) {
          if (!settle) continue;
          const pa = a.node.fixed ? 0 : a.node.r;
          const pb = b.node.fixed ? 0 : b.node.r;
          if (!pa && !pb) continue;
          if (pa && (!pb || pa <= pb)) wa = 1;
          else wb = 1;
        }
        if (d < 1e-6) {
          // Coincident: split along a direction fixed by the ids.
          const t = ((hashId(a.node.id + b.node.id) % 360) * Math.PI) / 180;
          dx = Math.cos(t);
          dy = Math.sin(t);
        } else {
          dx /= d;
          dy /= d;
        }
        const push = min - d;
        const share = wa + wb;
        a.x -= (dx * push * wa) / share;
        a.y -= (dy * push * wa) / share;
        b.x += (dx * push * wb) / share;
        b.y += (dy * push * wb) / share;
        // Inside the canvas as it goes, so the last clamp never undoes a separation.
        clampTo(a);
        clampTo(b);
        moved = true;
      }
    }
    if (!moved) break;
  }
};

/**
 * The solver: d3-force's forces, integrated for the free bodies only, on flat typed arrays (the
 * inner loops are O(free × all) and run up to `maxTicks` times). `step(k)` runs at most `k` more
 * ticks and says whether it is done; once done, the bodies hold their places.
 */
const createSolver = (
  bodies: Body[],
  links: readonly LayoutLink[],
  maxTicks: number,
  seed: number,
) => {
  const n = bodies.length;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const VX = new Float64Array(n);
  const VY = new Float64Array(n);
  const R = new Float64Array(n);
  const Q = new Float64Array(n);
  const AX = new Float64Array(n);
  const AY = new Float64Array(n);
  const AS = new Float64Array(n);
  const LX = new Float64Array(n);
  const LY = new Float64Array(n);
  const M = new Uint8Array(n);
  const index = new Map<string, number>();
  bodies.forEach((b, i) => {
    index.set(b.node.id, i);
    X[i] = b.x ?? 0;
    Y[i] = b.y ?? 0;
    R[i] = b.node.r;
    Q[i] = b.node.charge;
    AX[i] = b.node.anchor.x;
    AY[i] = b.node.anchor.y;
    AS[i] = b.node.anchorStrength;
    LX[i] = b.node.limit.x;
    LY[i] = b.node.limit.y;
    M[i] = b.mobile ? 1 : 0;
  });
  const free = Int32Array.from(bodies.flatMap((b, i) => (b.mobile ? [i] : [])));
  const PX = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  const rank = new Int32Array(n);
  const maxR = Math.max(...R);
  const springs = links
    .filter((l) => l.strength > 0 && index.has(l.source) && index.has(l.target))
    .map((l) => ({
      a: index.get(l.source)!,
      b: index.get(l.target)!,
      d: l.distance,
      k: l.strength,
    }))
    .filter((l) => M[l.a]! || M[l.b]!);
  const jiggle = lcg(seed);
  const split = () => (jiggle() - 0.5) * 1e-6;
  const DIST_MAX2 = 320 * 320;
  const KEEP = 0.6; // velocity kept per tick (d3's velocityDecay 0.4)
  const alphaDecay = 1 - Math.pow(0.001, 1 / maxTicks);
  let alpha = 1;
  let ticks = 0;
  let done = free.length === 0;
  const tick = () => {
    alpha += (0 - alpha) * alphaDecay;
    ticks++;
    // Springs: each pulls its ends towards its rest length; a held end does not give.
    for (const l of springs) {
      let dx = X[l.b]! + VX[l.b]! - X[l.a]! - VX[l.a]! || split();
      let dy = Y[l.b]! + VY[l.b]! - Y[l.a]! - VY[l.a]! || split();
      const d = Math.sqrt(dx * dx + dy * dy);
      const k = ((d - l.d) / d) * alpha * l.k * (M[l.a]! && M[l.b]! ? 0.5 : 1);
      dx *= k;
      dy *= k;
      if (M[l.b]!) {
        VX[l.b]! -= dx;
        VY[l.b]! -= dy;
      }
      if (M[l.a]!) {
        VX[l.a]! += dx;
        VY[l.a]! += dy;
      }
    }
    // Charge reaches DIST_MAX: walk out from each free node along x, both ways, until beyond it.
    order.sort((i, j) => X[i]! - X[j]!);
    for (let o = 0; o < n; o++) rank[order[o]!] = o;
    for (let f = 0; f < free.length; f++) {
      const a = free[f]!;
      // Pull to the anchor.
      let vx = VX[a]! + (AX[a]! - X[a]!) * AS[a]! * alpha;
      let vy = VY[a]! + (AY[a]! - Y[a]!) * AS[a]! * alpha;
      // Charge from every other node within reach (each repels with its own strength).
      const ax = X[a]!;
      const ay = Y[a]!;
      for (let dir = -1; dir <= 1; dir += 2)
        for (let o = rank[a]! + dir; o >= 0 && o < n; o += dir) {
          const b = order[o]!;
          let dx = X[b]! - ax;
          if (dx * dx >= DIST_MAX2) break;
          let dy = Y[b]! - ay;
          let l = dx * dx + dy * dy;
          if (l >= DIST_MAX2) continue;
          if (l === 0) {
            dx = split();
            dy = split();
            l = dx * dx + dy * dy;
          }
          if (l < 1) l = Math.sqrt(l);
          const w = (Q[b]! * alpha) / l;
          vx += dx * w;
          vy += dy * w;
        }
      VX[a] = vx;
      VY[a] = vy;
    }
    // Collision on the predicted positions, twice per tick (d3's iterations(2)): a sweep along
    // x, so only nodes near each other are compared.
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < n; i++) PX[i] = X[i]! + VX[i]!;
      order.sort((i, j) => PX[i]! - PX[j]!);
      for (let oi = 0; oi < n; oi++) {
        const a = order[oi]!;
        const reach = R[a]! + maxR;
        for (let oj = oi + 1; oj < n; oj++) {
          const b = order[oj]!;
          if (PX[b]! - PX[a]! >= reach) break;
          if (!M[a]! && !M[b]!) continue;
          const r = R[a]! + R[b]!;
          let dx = PX[a]! - PX[b]!;
          let dy = Y[a]! + VY[a]! - Y[b]! - VY[b]!;
          let l = dx * dx + dy * dy;
          if (l >= r * r) continue;
          if (l === 0) {
            dx = split();
            dy = split();
            l = dx * dx + dy * dy;
          }
          l = Math.sqrt(l);
          const k = (r - l) / l;
          const sa = M[a]! ? (M[b]! ? 0.5 : 1) : 0;
          const sb = M[b]! ? (M[a]! ? 0.5 : 1) : 0;
          VX[a]! += dx * k * sa;
          VY[a]! += dy * k * sa;
          VX[b]! -= dx * k * sb;
          VY[b]! -= dy * k * sb;
        }
      }
    }
    let v = 0;
    for (let f = 0; f < free.length; f++) {
      const a = free[f]!;
      VX[a]! *= KEEP;
      VY[a]! *= KEEP;
      X[a] = Math.max(-LX[a]!, Math.min(LX[a]!, X[a]! + VX[a]!));
      Y[a] = Math.max(-LY[a]!, Math.min(LY[a]!, Y[a]! + VY[a]!));
      v = Math.max(v, Math.abs(VX[a]!), Math.abs(VY[a]!));
    }
    // At rest: nothing free moves more than a twentieth of a pixel a tick (the tween to the
    // place is what the viewer sees, so sub-pixel settling is not worth the time).
    if ((ticks > 12 && v < 0.05) || ticks >= maxTicks) done = true;
  };
  const step = (k: number) => {
    for (let i = 0; i < k && !done; i++) tick();
    if (done)
      for (let f = 0; f < free.length; f++) {
        const a = free[f]!;
        bodies[a]!.x = X[a]!;
        bodies[a]!.y = Y[a]!;
      }
    return done;
  };
  return { step, ticks: () => ticks };
};

/** A layout in progress: `step(k)` runs up to `k` solver ticks; `result()` once it is done. */
export type LayoutJob = {
  /** Nodes the solver places (neither fixed nor pinned). */
  free: number;
  /** Run up to `ticks` more solver ticks. True once the layout is at rest. */
  step: (ticks: number) => boolean;
  /** The places, once `step` has returned true. */
  result: () => LayoutResult;
};

/**
 * Start a layout that can be run in slices (a few ticks per frame), so a big batch never blocks
 * the main thread for long. Run to the end, it gives exactly what `layoutGraph` gives.
 */
export const startLayout = (
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  options: LayoutOptions = {},
): LayoutJob => {
  const maxTicks = options.maxTicks ?? 90;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Start points: held nodes where they are held; new ones beside their parent.
  const start = new Map<string, LayoutPoint>();
  const startOf = (n: LayoutNode, depth = 0): LayoutPoint => {
    const known = start.get(n.id);
    if (known) return known;
    const held = n.fixed ?? n.pinned ?? n.start;
    let p: LayoutPoint;
    if (held) p = held;
    else {
      const parent = n.parent ? byId.get(n.parent) : undefined;
      p =
        parent && depth < 4
          ? besideParent({ ...startOf(parent, depth + 1), r: parent.r }, n.anchor, n.id, n.r)
          : n.anchor;
    }
    start.set(n.id, p);
    return p;
  };

  const bodies: Body[] = nodes.map((node) => {
    const p = startOf(node);
    const held = node.fixed ?? node.pinned;
    return { node, mobile: !held, x: held?.x ?? p.x, y: held?.y ?? p.y };
  });
  const free = bodies.filter((b) => b.mobile).length;
  const solver = createSolver(bodies, links, maxTicks, options.seed ?? 221);
  let out: LayoutResult | null = null;
  const step = (ticks: number) => {
    if (out) return true;
    if (!solver.step(ticks)) return false;
    separate(bodies, options.settle);
    for (const b of bodies) clampTo(b);
    const positions = new Map<string, LayoutPoint>();
    for (const b of bodies) positions.set(b.node.id, { x: b.x, y: b.y });
    out = { positions, free, ticks: solver.ticks() };
    return true;
  };
  const result = () => {
    if (!out) throw new Error('layout not finished: step it until it returns true');
    return out;
  };
  return { free, step, result };
};

/**
 * Lay the graph out to rest. Same input, same output./**
 * Lay the graph out to rest. Same input, same output.
 *
 * The solver is d3-force's model (many-body charge, collision, a pull to the anchor, springs on
 * the links, velocity decay and a cooling alpha) run headless, but it only integrates the free
 * nodes: fixed and pinned ones are obstacles that push and pull, never move, and cost nothing to
 * step. A tick is O(free × all); d3's own loop rebuilds a Barnes–Hut quadtree over every node
 * each tick, which at a few hundred nodes costs more than it saves (and an arrival would pay for
 * the whole graph). At rest early once nothing free moves a twentieth of a pixel a tick.
 */
export const layoutGraph = (
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  options: LayoutOptions = {},
): LayoutResult => {
  const job = startLayout(nodes, links, options);
  job.step(Infinity);
  return job.result();
};

// ---- sector arrangement (#272) --------------------------------------------------------------

/** Below this canvas width the sectors leave their ring for a grid (phones, #272). */
export const COMPACT_WIDTH = 560;

export type SectorArrangementInput = {
  /** How many sectors. */
  count: number;
  /** The canvas, px. */
  width: number;
  height: number;
  /** A sector's largest body radius at full size (`sectorRadius.max`). */
  maxBody: number;
  /** Room a sector keeps beyond its body: its progress arc and a margin (the layout's `r` less the body). */
  ringRoom: number;
  /** Room the hub keeps around its centre (its collision radius). */
  hubRoom: number;
};

export type SectorArrangement = {
  /** `ring`: an ellipse round the hub (wide canvases); `grid`: rows above and below it (phones). */
  kind: 'ring' | 'grid';
  /** Each sector's fixed place, in input order, centred on the hub at the origin. */
  slots: LayoutPoint[];
  /** What sector bodies are scaled by (1 = `maxBody`). */
  scale: number;
  /**
   * The arrangement's half extent: places are stored relative to it, so a resize that keeps the
   * kind scales every place with the sectors.
   */
  radii: LayoutPoint;
  /** Grid only. */
  cols: number;
  rows: number;
};

/**
 * Where the sectors stand. Pure and deterministic: the canvas and the count decide everything,
 * never the data, so live updates move no sector (#192, #202, #221).
 *
 * - **Ring** (`width >= COMPACT_WIDTH`): an ellipse fitted to the canvas, the first sector at
 *   the top, leaving room for satellites outside it. Sectors shrink on small canvases.
 * - **Grid** (narrower, #272): the ring's six circles cannot share a phone's column without
 *   overlapping, so they stand in rows of up to three, half above the hub and half below it, with
 *   a band in the middle for the hub and the branches and pull requests forked from it, and a
 *   band above and below for open issues. Each sector's radius is the largest that fits its cell,
 *   so no two sectors (arcs included) can overlap at any width. A short last row is centred.
 */
export const arrangeSectors = (input: SectorArrangementInput): SectorArrangement => {
  const { count, width, height, maxBody, ringRoom, hubRoom } = input;
  if (width >= COMPACT_WIDTH || count === 0) {
    const scale = Math.max(0.6, Math.min(1, Math.min(width, height) / 620));
    const radii = {
      x: Math.max(100, width / 2 - 140 * scale),
      y: Math.max(100, height / 2 - 120 * scale),
    };
    const slots = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(a) * radii.x, y: Math.sin(a) * radii.y };
    });
    return { kind: 'ring', slots, scale, radii, cols: 0, rows: 0 };
  }
  const EDGE = 6; // canvas edge to the outermost arc
  const OUTER = 36; // band above the top row and below the bottom row (issues, agents)
  const MIDDLE = Math.max(hubRoom + 14, 56); // half the band through the hub (agents, branches)
  const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const upper = Math.ceil(rows / 2);
  const lower = rows - upper;
  const tallest = Math.max(upper, lower);
  // A cell's half size: what one sector (body, arc, margin) may take.
  const cell = Math.max(
    ringRoom + 8,
    Math.min((width / 2 - EDGE) / cols, (height / 2 - EDGE - OUTER - MIDDLE) / (2 * tallest)),
  );
  const body = Math.min(maxBody, cell - ringRoom);
  const slots: LayoutPoint[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    const col = i % cols;
    const x = (col - (inRow - 1) / 2) * 2 * cell;
    // Rows above the hub count outwards from it; the first row is the top one.
    const y =
      row < upper
        ? -(MIDDLE + cell + 2 * cell * (upper - 1 - row))
        : MIDDLE + cell + 2 * cell * (row - upper);
    slots.push({ x, y });
  }
  return {
    kind: 'grid',
    slots,
    scale: body / maxBody,
    radii: { x: Math.max(cell, (cols - 1) * cell), y: MIDDLE + cell + 2 * cell * (tallest - 1) },
    cols,
    rows,
  };
};
