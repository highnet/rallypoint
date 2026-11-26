/**
 * Particle effects for the swarm graph: pure, framework-free, renderer-agnostic. A host's GPU
 * layer (three.js on the arena's fleet page) owns the drawing; this module owns the particles.
 *
 * - `createParticlePool(capacity)`: a fixed-size pool. Every attribute lives in a preallocated
 *   typed array laid out for upload as GPU buffers, live particles stay packed at the front, and
 *   nothing allocates per frame.
 * - Emitters (`emitComet`, `emitMergeBurst`, …): one per effect the graph shows, each a few
 *   lines of initial conditions written into the pool.
 * - `createQuality()`: picks a quality level from measured frame times, with hysteresis, so a
 *   slow machine sheds particles and post-processing instead of dropping frames.
 * - `createActivity()`: how busy each node has been lately (a decaying count), for lighting.
 *
 * Coordinates are the graph's own (the SVG's user space, origin at the centre); `z` is depth for
 * parallax only (negative is behind the graph, positive in front).
 */

export type Rgb = { r: number; g: number; b: number };

/** Sprite shapes the fragment shader draws: a soft dot, a shaded ring, a flare, a spinning shard. */
export const SHAPE = { dot: 0, ring: 1, flare: 2, shard: 3 } as const;
export type ParticleShape = (typeof SHAPE)[keyof typeof SHAPE];

/** One particle's initial conditions. Velocities are px/s, accelerations px/s². */
export type ParticleSpec = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  /** Lifetime, ms. */
  life: number;
  /** Sprite size at birth and at death, px. */
  size: number;
  sizeEnd: number;
  r: number;
  g: number;
  b: number;
  /** Peak opacity. */
  alpha: number;
  shape: ParticleShape;
  /** Rotation speed, rad/s (shards). */
  spin: number;
  /** Fraction of velocity kept per second (1 keeps all). */
  drag: number;
  /** Downward acceleration (negative rises). */
  gravity: number;
  /** Pull towards (px, py), per second; 0 for none. Merge sprays settle into their node. */
  pull: number;
  px: number;
  py: number;
};

/** Floats per particle in each GPU-ready array. */
export const STRIDE = { position: 3, color: 4, extra: 4 } as const;

export type ParticlePool = {
  readonly capacity: number;
  /** Live particles, packed at indexes [0, count). */
  readonly count: number;
  /** x, y, z per particle. */
  readonly position: Float32Array;
  /** r, g, b, alpha per particle (alpha already faded by age). */
  readonly color: Float32Array;
  /** size, shape, angle, life fraction per particle. */
  readonly extra: Float32Array;
  /** A scratch spec, reset by `spec()`, for emitters that want to avoid allocating. */
  spec: () => ParticleSpec;
  /** Add one particle; false when the pool (or its current limit) is full. */
  emit: (p: ParticleSpec) => boolean;
  /** Advance every particle by `dtMs`, retiring the dead. */
  step: (dtMs: number) => void;
  /** Cap the live count below the capacity (adaptive quality); never grows the arrays. */
  setLimit: (n: number) => void;
  readonly limit: number;
  clear: () => void;
};

const blank = (): ParticleSpec => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  life: 600,
  size: 4,
  sizeEnd: 0,
  r: 1,
  g: 1,
  b: 1,
  alpha: 1,
  shape: SHAPE.dot,
  spin: 0,
  drag: 1,
  gravity: 0,
  pull: 0,
  px: 0,
  py: 0,
});

/** Simulation-only floats per particle: vx, vy, age, life, size0, size1, alpha, spin, drag,
 * gravity, pull, px, py. */
const SIM = 13;

export const createParticlePool = (capacity: number): ParticlePool => {
  const cap = Math.max(1, Math.floor(capacity));
  const position = new Float32Array(cap * STRIDE.position);
  const color = new Float32Array(cap * STRIDE.color);
  const extra = new Float32Array(cap * STRIDE.extra);
  const sim = new Float32Array(cap * SIM);
  const defaults = Object.freeze(blank());
  const scratch = blank();
  let count = 0;
  let limit = cap;

  const copy = (from: number, to: number) => {
    position.copyWithin(to * 3, from * 3, from * 3 + 3);
    color.copyWithin(to * 4, from * 4, from * 4 + 4);
    extra.copyWithin(to * 4, from * 4, from * 4 + 4);
    sim.copyWithin(to * SIM, from * SIM, from * SIM + SIM);
  };

  const pool: ParticlePool = {
    capacity: cap,
    get count() {
      return count;
    },
    get limit() {
      return limit;
    },
    position,
    color,
    extra,
    spec: () => Object.assign(scratch, defaults),
    emit: (p) => {
      if (count >= limit) return false;
      const i = count++;
      position[i * 3] = p.x;
      position[i * 3 + 1] = p.y;
      position[i * 3 + 2] = p.z;
      color[i * 4] = p.r;
      color[i * 4 + 1] = p.g;
      color[i * 4 + 2] = p.b;
      color[i * 4 + 3] = 0;
      extra[i * 4] = p.size;
      extra[i * 4 + 1] = p.shape;
      extra[i * 4 + 2] = Math.random() * Math.PI * 2;
      extra[i * 4 + 3] = 0;
      const s = i * SIM;
      sim[s] = p.vx;
      sim[s + 1] = p.vy;
      sim[s + 2] = 0;
      sim[s + 3] = Math.max(1, p.life);
      sim[s + 4] = p.size;
      sim[s + 5] = p.sizeEnd;
      sim[s + 6] = p.alpha;
      sim[s + 7] = p.spin;
      sim[s + 8] = p.drag;
      sim[s + 9] = p.gravity;
      sim[s + 10] = p.pull;
      sim[s + 11] = p.px;
      sim[s + 12] = p.py;
      return true;
    },
    step: (dtMs) => {
      const dt = Math.max(0, Math.min(100, dtMs)) / 1000;
      let i = 0;
      while (i < count) {
        const s = i * SIM;
        const age = sim[s + 2]! + dt * 1000;
        const life = sim[s + 3]!;
        if (age >= life) {
          // Swap the last live particle into this slot: the live set stays packed.
          count--;
          if (i !== count) copy(count, i);
          continue;
        }
        sim[s + 2] = age;
        const keep = sim[s + 8]! >= 1 ? 1 : Math.pow(sim[s + 8]!, dt);
        let vx = sim[s]! * keep;
        let vy = sim[s + 1]! * keep + sim[s + 9]! * dt;
        const pull = sim[s + 10]!;
        const p = i * 3;
        if (pull > 0) {
          vx += (sim[s + 11]! - position[p]!) * pull * dt;
          vy += (sim[s + 12]! - position[p + 1]!) * pull * dt;
        }
        sim[s] = vx;
        sim[s + 1] = vy;
        position[p]! += vx * dt;
        position[p + 1]! += vy * dt;
        const t = age / life;
        const e = i * 4;
        extra[e] = sim[s + 4]! + (sim[s + 5]! - sim[s + 4]!) * t;
        extra[e + 2]! += sim[s + 7]! * dt;
        extra[e + 3] = t;
        color[e + 3] = sim[s + 6]! * fade(t);
        i++;
      }
    },
    setLimit: (n) => {
      limit = Math.max(0, Math.min(cap, Math.floor(n)));
      if (count > limit) count = limit;
    },
    clear: () => {
      count = 0;
    },
  };
  return pool;
};

/** Opacity over a particle's life: a quick rise, then an ease-out fade. */
export const fade = (t: number) => {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.08) return t / 0.08;
  const u = (t - 0.08) / 0.92;
  return 1 - u * u;
};

// ---- emitters ---------------------------------------------------------------------------------

/** A tiny seeded-or-not random source; emitters take one so tests can pin it. */
export type Random = () => number;

const tint = (p: ParticleSpec, c: Rgb, k = 1) => {
  p.r = Math.min(1, c.r * k);
  p.g = Math.min(1, c.g * k);
  p.b = Math.min(1, c.b * k);
};

/** One point of a comet's tail, dropped where the spark's head is now. */
export const emitComet = (
  pool: ParticlePool,
  x: number,
  y: number,
  c: Rgb,
  size: number,
  rand: Random = Math.random,
) => {
  const p = pool.spec();
  p.x = x + (rand() - 0.5) * 1.5;
  p.y = y + (rand() - 0.5) * 1.5;
  p.z = 0.4;
  p.life = 360 + rand() * 120;
  p.size = size * 2.4;
  p.sizeEnd = size * 0.4;
  p.alpha = 0.85;
  tint(p, c, 1.15);
  return pool.emit(p);
};

/** A merge: a radial spray out of the sector node that slows and settles back into it. */
export const emitMergeBurst = (
  pool: ParticlePool,
  x: number,
  y: number,
  radius: number,
  c: Rgb,
  count = 60,
  rand: Random = Math.random,
) => {
  for (let i = 0; i < count; i++) {
    const p = pool.spec();
    const a = (i / count) * Math.PI * 2 + rand() * 0.3;
    const v = 140 + rand() * 220;
    p.x = x + Math.cos(a) * radius * 0.5;
    p.y = y + Math.sin(a) * radius * 0.5;
    p.z = 0.2 + rand() * 0.6;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
    p.drag = 0.02;
    p.pull = 24;
    p.px = x;
    p.py = y;
    p.life = 700 + rand() * 350;
    p.size = 3 + rand() * 4;
    p.sizeEnd = 1;
    tint(p, c, 1.25);
    if (!pool.emit(p)) return;
  }
};

/** A rating rise: a short upward fountain, sized by the delta. A fall is a few sinking motes. */
export const emitRatingFountain = (
  pool: ParticlePool,
  x: number,
  y: number,
  radius: number,
  c: Rgb,
  delta: number,
  rand: Random = Math.random,
) => {
  const up = delta > 0;
  const count = Math.round(Math.min(70, 10 + Math.abs(delta) * (up ? 0.35 : 0.1)));
  for (let i = 0; i < count; i++) {
    const p = pool.spec();
    const spread = (rand() - 0.5) * 0.9;
    const v = up ? 160 + rand() * 160 : 30 + rand() * 40;
    p.x = x + spread * radius;
    p.y = y - (up ? radius * 0.6 : -radius * 0.2);
    p.z = 0.3 + rand() * 0.6;
    p.vx = spread * v * 0.6;
    p.vy = up ? -v : v;
    p.gravity = up ? 260 : 20;
    p.drag = 0.4;
    p.life = up ? 800 + rand() * 400 : 900;
    p.size = 2.5 + rand() * 3;
    p.sizeEnd = 0.5;
    tint(p, c, up ? 1.2 : 0.6);
    if (!pool.emit(p)) return;
  }
};

/** A rung cleared: an expanding shockwave of particles, and one shaded ring billboard. */
export const emitShockwave = (
  pool: ParticlePool,
  x: number,
  y: number,
  radius: number,
  c: Rgb,
  count = 56,
  rand: Random = Math.random,
) => {
  const ring = pool.spec();
  ring.x = x;
  ring.y = y;
  ring.z = 0.5;
  ring.shape = SHAPE.ring;
  ring.life = 850;
  ring.size = radius * 2;
  ring.sizeEnd = radius * 2 + 260;
  ring.alpha = 0.9;
  tint(ring, c, 1.2);
  pool.emit(ring);
  for (let i = 0; i < count; i++) {
    const p = pool.spec();
    const a = (i / count) * Math.PI * 2;
    const v = 190 + rand() * 25;
    p.x = x + Math.cos(a) * radius;
    p.y = y + Math.sin(a) * radius;
    p.z = 0.5;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
    p.drag = 0.15;
    p.life = 700;
    p.size = 3;
    p.sizeEnd = 1;
    tint(p, c, 1.3);
    if (!pool.emit(p)) return;
  }
};

/** A buried idea: it comes apart gently into drifting embers and a few turning shards. */
export const emitEmbers = (
  pool: ParticlePool,
  x: number,
  y: number,
  radius: number,
  c: Rgb,
  rand: Random = Math.random,
) => {
  for (let i = 0; i < 26; i++) {
    const p = pool.spec();
    const a = rand() * Math.PI * 2;
    const d = rand() * radius;
    p.x = x + Math.cos(a) * d;
    p.y = y + Math.sin(a) * d;
    p.z = 0.2 + rand() * 0.4;
    p.vx = (rand() - 0.5) * 24;
    p.vy = -12 - rand() * 22;
    p.gravity = -6;
    p.life = 1400 + rand() * 900;
    p.size = 1.5 + rand() * 2;
    p.sizeEnd = 0.3;
    p.alpha = 0.7;
    // Embers glow warm, whatever the sector's colour.
    p.r = Math.min(1, 0.55 + c.r * 0.45);
    p.g = Math.min(1, 0.32 + c.g * 0.3);
    p.b = Math.min(1, 0.12 + c.b * 0.15);
    if (!pool.emit(p)) return;
  }
  for (let i = 0; i < 8; i++) {
    const p = pool.spec();
    const a = (i / 8) * Math.PI * 2 + rand();
    p.x = x;
    p.y = y;
    p.z = 0.6;
    p.vx = Math.cos(a) * (30 + rand() * 30);
    p.vy = Math.sin(a) * (30 + rand() * 30) - 10;
    p.shape = SHAPE.shard;
    p.spin = (rand() - 0.5) * 9;
    p.drag = 0.5;
    p.life = 1200 + rand() * 500;
    p.size = 7 + rand() * 5;
    p.sizeEnd = 2;
    p.alpha = 0.8;
    tint(p, c, 0.9);
    if (!pool.emit(p)) return;
  }
};

/** A version landing: a brief cross-shaped glint. */
export const emitFlare = (pool: ParticlePool, x: number, y: number, radius: number, c: Rgb) => {
  const p = pool.spec();
  p.x = x;
  p.y = y;
  p.z = 0.9;
  p.shape = SHAPE.flare;
  p.life = 520;
  p.size = radius * 3.2;
  p.sizeEnd = radius * 1.2;
  tint(p, c, 1.5);
  return pool.emit(p);
};

/** A small puff where a spark passes through a node on its way. */
export const emitPuff = (
  pool: ParticlePool,
  x: number,
  y: number,
  c: Rgb,
  count = 8,
  rand: Random = Math.random,
) => {
  for (let i = 0; i < count; i++) {
    const p = pool.spec();
    const a = rand() * Math.PI * 2;
    const v = 40 + rand() * 60;
    p.x = x;
    p.y = y;
    p.z = 0.4;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
    p.drag = 0.05;
    p.life = 420;
    p.size = 2.5;
    p.sizeEnd = 0.5;
    tint(p, c);
    if (!pool.emit(p)) return;
  }
};

/** A slow sparkle on a node's rim: agents are on it. */
export const emitSparkle = (
  pool: ParticlePool,
  x: number,
  y: number,
  radius: number,
  c: Rgb,
  rand: Random = Math.random,
) => {
  const p = pool.spec();
  const a = rand() * Math.PI * 2;
  p.x = x + Math.cos(a) * radius * (0.9 + rand() * 0.4);
  p.y = y + Math.sin(a) * radius * (0.9 + rand() * 0.4);
  p.z = 0.3;
  p.vy = -8;
  p.life = 900 + rand() * 500;
  p.size = 2 + rand() * 2;
  p.sizeEnd = 0.2;
  p.alpha = 0.75;
  tint(p, c, 1.3);
  return pool.emit(p);
};

/** Ambient dust: faint motes drifting behind the graph (deeper ones slower). */
export const emitMote = (
  pool: ParticlePool,
  width: number,
  height: number,
  c: Rgb,
  rand: Random = Math.random,
) => {
  const p = pool.spec();
  const z = -0.3 - rand() * 0.7;
  p.x = (rand() - 0.5) * width;
  p.y = (rand() - 0.5) * height;
  p.z = z;
  const speed = 6 + (1 + z) * 10;
  const a = rand() * Math.PI * 2;
  p.vx = Math.cos(a) * speed;
  p.vy = Math.sin(a) * speed;
  p.life = 4000 + rand() * 4000;
  p.size = 1.5 + rand() * 2;
  p.sizeEnd = p.size;
  p.alpha = 0.22;
  tint(p, c, 0.9);
  return pool.emit(p);
};

// ---- adaptive quality -------------------------------------------------------------------------

export type QualityLevel = 'high' | 'medium' | 'low';
const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

/**
 * What each level allows: a share of the host's particle budget, the canvases' resolution, how
 * often the background redraws (every n-th frame) and which extras run.
 */
export const QUALITY: Record<
  QualityLevel,
  {
    particles: number;
    resolution: number;
    backgroundEvery: number;
    trails: boolean;
    post: boolean;
    bloom: boolean;
    ambient: boolean;
  }
> = {
  high: {
    particles: 1,
    resolution: 1,
    backgroundEvery: 1,
    trails: true,
    post: true,
    bloom: true,
    ambient: true,
  },
  medium: {
    particles: 0.55,
    resolution: 0.75,
    backgroundEvery: 2,
    trails: true,
    post: true,
    bloom: true,
    ambient: false,
  },
  low: {
    particles: 0.25,
    resolution: 0.5,
    backgroundEvery: 4,
    trails: false,
    post: false,
    bloom: false,
    ambient: false,
  },
};

export type QualityOptions = {
  initial?: QualityLevel;
  /** Highest level allowed. */
  max?: QualityLevel;
  /** Smoothed frame time above this steps down. Default 20 ms (a slipping 60 fps). */
  slowMs?: number;
  /** Smoothed frame time below this, held long enough, steps back up. Default 13 ms. */
  fastMs?: number;
  /** How long (ms of frames) a condition must hold first. Default 1.5 s down, 8 s up. */
  downAfterMs?: number;
  upAfterMs?: number;
  /** At the lowest level, frames this slow for `giveUpAfterMs` mean the layer should stop. */
  giveUpMs?: number;
  giveUpAfterMs?: number;
};

export type Quality = {
  readonly level: QualityLevel;
  /** The smoothed frame time, ms. */
  readonly frameMs: number;
  /**
   * Even the lowest level cannot keep up (frames slower than `giveUpMs` for `giveUpAfterMs`):
   * the host should switch its effects off and leave the graph alone.
   */
  readonly hopeless: boolean;
  /** Feed one frame's time; returns the (possibly new) level. */
  sample: (frameMs: number) => QualityLevel;
  setMax: (max: QualityLevel) => void;
};

export const createQuality = (options: QualityOptions = {}): Quality => {
  let max = LEVELS.indexOf(options.max ?? 'high');
  let level = Math.min(max, LEVELS.indexOf(options.initial ?? 'high'));
  const slow = options.slowMs ?? 20;
  const fast = options.fastMs ?? 13;
  const downAfter = options.downAfterMs ?? 1500;
  const upAfter = options.upAfterMs ?? 8000;
  const giveUp = options.giveUpMs ?? 50;
  const giveUpAfter = options.giveUpAfterMs ?? 4000;
  let ema = 16.7;
  let slowFor = 0;
  let fastFor = 0;
  let hopelessFor = 0;
  return {
    get level() {
      return LEVELS[level]!;
    },
    get frameMs() {
      return ema;
    },
    get hopeless() {
      return hopelessFor >= giveUpAfter;
    },
    sample: (raw) => {
      // A frame after a hidden tab or a breakpoint says nothing about the machine.
      if (!(raw > 0) || raw > 1000) return LEVELS[level]!;
      const ms = Math.min(raw, 250);
      ema += (ms - ema) * 0.1;
      slowFor = ema > slow ? slowFor + ms : 0;
      fastFor = ema < fast ? fastFor + ms : 0;
      hopelessFor = level === 0 && ema > giveUp ? hopelessFor + ms : 0;
      if (slowFor >= downAfter && level > 0) {
        level--;
        slowFor = 0;
        // Give the lighter level a fair start.
        ema = (slow + fast) / 2;
      } else if (fastFor >= upAfter && level < max) {
        level++;
        fastFor = 0;
      }
      return LEVELS[level]!;
    },
    setMax: (m) => {
      max = LEVELS.indexOf(m);
      level = Math.min(level, max);
    },
  };
};

// ---- activity ---------------------------------------------------------------------------------

export type Activity = {
  /** Something happened at a node. */
  bump: (id: string, amount?: number) => void;
  /** Let every node's activity decay by `dtMs`. */
  decay: (dtMs: number) => void;
  /** 0 (quiet) to 1 (busy), saturating. */
  level: (id: string) => number;
};

/** How busy each node has been lately: a count with a half-life, squashed into [0, 1). */
export const createActivity = (halfLifeMs = 20_000, saturation = 4): Activity => {
  const raw = new Map<string, number>();
  return {
    bump: (id, amount = 1) => raw.set(id, (raw.get(id) ?? 0) + amount),
    decay: (dtMs) => {
      const k = Math.pow(0.5, Math.max(0, dtMs) / halfLifeMs);
      for (const [id, v] of raw) {
        const next = v * k;
        if (next < 0.01) raw.delete(id);
        else raw.set(id, next);
      }
    },
    level: (id) => {
      const v = raw.get(id) ?? 0;
      return v / (v + saturation);
    },
  };
};
