/**
 * The memory tables `<LiveRefresh>` listens to. Keep this in step with
 * `swarm_realtime_wanted()` in .rallypoint/swarm/schema.sql: a table that is
 * not in the supabase_realtime publication sends no changes.
 */
export const LIVE_TABLES = [
  "swarm_sessions",
  "swarm_progress",
  "swarm_retros",
  "swarm_messages",
  "swarm_results",
  "swarm_versions",
  "swarm_buried",
  "swarm_concepts",
  "swarm_concept_trials",
  "swarm_protocol_changes",
] as const;

/**
 * A tiny shared signal between `<LiveRefresh>` (mounted once in the layout)
 * and anything on a page that must not be re-rendered under the reader, such
 * as the fleet graph while a replay plays. While at least one hold is active,
 * live updates and the fallback poll wait; one refresh runs when the last
 * hold is released, if anything changed meanwhile.
 *
 * Browser-only state with no imports, so server code may import LIVE_TABLES.
 * Components use `useLiveHold(active)` from ../_components/live.
 */

const holds = new Set<symbol>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Pause live refreshes until the returned function is called. */
export function holdLive(): () => void {
  const hold = Symbol("live-hold");
  holds.add(hold);
  if (holds.size === 1) emit();
  return () => {
    if (holds.delete(hold) && holds.size === 0) emit();
  };
}

export function isLiveHeld(): boolean {
  return holds.size > 0;
}

/** Called whenever the signal turns held or free. Returns an unsubscribe. */
export function onLiveHoldChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
