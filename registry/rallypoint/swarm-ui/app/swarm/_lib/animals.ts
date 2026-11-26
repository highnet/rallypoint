/**
 * Every agent's animal on the fleet graph, the way Swarm Arena draws its
 * agents (its `shared/src/animals.ts`): a game-icons.net silhouette in place of
 * the role letter, so a fleet of workers is not a field of identical "W"s.
 * The role stays on the node's sub-line, its tooltip and its accessible name.
 *
 * Pure and deterministic: no clock, no randomness, no DOM. An id's preferred
 * animal is a hash of the id, the same hash Arena uses, so an id that meets no
 * collision gets the animal Arena would give it. Within one fleet, distinct
 * agents get distinct animals while there are animals to go round: ids are
 * placed in the order they sort (so the order rows arrive in never matters),
 * and an id whose animal is taken probes along a second-hash stride to the
 * next free one. The same roster therefore always draws the same animals,
 * on the server, on the client, on every reload and in every replay.
 *
 * SVG paths rather than emoji, as in Arena: an emoji is a different picture on
 * every OS (or a box where there is no colour font), while a path is drawn
 * identically everywhere and takes the graph's ink colour in either theme.
 */

import { ANIMAL_ICONS, ANIMAL_VIEWBOX } from "./animal-icons";

export type Animal = {
  /** The game-icons.net name, e.g. `sea-turtle`. */
  slug: string;
  /** The animal in words, e.g. `Sea turtle`: part of the agent's accessible name. */
  name: string;
  /** One SVG path in a `0 0 ANIMAL_VIEWBOX ANIMAL_VIEWBOX` box. */
  d: string;
};

export { ANIMAL_VIEWBOX };

export const ANIMALS: readonly Animal[] = ANIMAL_ICONS.map(([slug, name, d]) => ({ slug, name, d }));

/** FNV-1a with a salt and a final avalanche (Arena's, unchanged), so ids differing in one digit land far apart. */
function hash(s: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Arena writes engine seats as `chess/search`; the same agent written either way is one animal. */
const normal = (id: string) => id.replace(/\//g, "-");

/** An id's own animal, before any collision: `ANIMALS` index. */
export function preferredAnimalIndex(id: string): number {
  return hash(normal(id), 0) % ANIMALS.length;
}

/** Open addressing: the id's own slot, else the next free one along its second-hash stride. */
function probe(id: string, taken: Set<number>): number {
  const n = ANIMALS.length;
  const start = preferredAnimalIndex(id);
  if (taken.size >= n) return start; // More agents than animals: share, deterministically.
  const step = 1 + (hash(normal(id), 0x9e3779b9) % (n - 1));
  for (let i = 0, k = start; i < n; i++, k = (k + step) % n) if (!taken.has(k)) return k;
  // A stride sharing a factor with the set's size cycles early: scan the rest in order.
  for (let i = 0; i < n; i++) if (!taken.has((start + i) % n)) return (start + i) % n;
  return start;
}

/** Code-unit order, not `localeCompare`: the same on every server and browser, whatever its locale. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The animal (`ANIMALS` index) of every agent in one view. `keep` holds
 * animals already on screen, which stay where they are, so an agent arriving
 * mid-session takes a free animal instead of displacing one being shown; a
 * fresh load passes nothing and gets the plain sorted assignment.
 */
export function assignAnimals(ids: Iterable<string>, keep?: ReadonlyMap<string, number>): Map<string, number> {
  const assigned = new Map<string, number>();
  const taken = new Set<number>();
  const unique = [...new Set(ids)].sort(byCodeUnit);
  for (const id of unique) {
    const kept = keep?.get(id);
    if (kept === undefined || kept < 0 || kept >= ANIMALS.length) continue;
    assigned.set(id, kept);
    taken.add(kept);
  }
  for (const id of unique) {
    if (assigned.has(id)) continue;
    const k = probe(id, taken);
    assigned.set(id, k);
    taken.add(k);
  }
  return assigned;
}

/** An agent's animal, from a view's assignment, or its own preferred one outside any view. */
export function animalOf(id: string, assigned?: ReadonlyMap<string, number>): Animal {
  return ANIMALS[assigned?.get(id) ?? preferredAnimalIndex(id)]!;
}
