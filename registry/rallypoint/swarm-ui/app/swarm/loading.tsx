/**
 * Every swarm page reads memory at request time (`getSwarmContext()` calls
 * `connection()` first), so every page renders inside a Suspense boundary.
 * This file is the fallback for `/swarm` itself, and each route folder's
 * `loading.tsx` re-exports it.
 *
 * Why one per folder: on a client navigation only the segments below the
 * layout both pages share re-render, and `/swarm/*` pages all share
 * `app/swarm/layout.tsx`. A boundary in this folder sits in that shared
 * segment, so it would cover a page load but not a move from `/swarm/fleet`
 * to `/swarm/board`. A boundary in the page's own folder covers both, so the
 * top bar and sidebar (the static shell) show at once and the page streams
 * in. An `[id]` folder needs its own, because two of its pages share the
 * list's segment.
 *
 * A new route folder gets the same one-line `loading.tsx`.
 */
export default function SwarmLoading() {
  return (
    <p aria-live="polite" className="rp-soft" role="status">
      Loading…
    </p>
  );
}
