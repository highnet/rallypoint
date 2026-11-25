/**
 * Row types for every table and view in Rallypoint Swarm's Supabase schema
 * (`.rallypoint/swarm/schema.sql`). Names and columns follow
 * docs/swarm/CONTRACT.md exactly. PostgREST returns timestamps as ISO
 * strings, bigint ids as numbers and jsonb as parsed JSON.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Visibility = "public" | "private";

export type MeasureMode = "score" | "checks" | "review";

export type GoalMeasure = {
  mode?: MeasureMode;
  label?: string;
  command?: string;
  checks?: { name: string; command?: string }[];
  direction?: "higher" | "lower";
  margin?: number;
  unit?: string;
};

export type GoalSetting = {
  title?: string;
  pitch?: string;
  statement?: string;
  measure?: GoalMeasure;
};

/** `swarm_settings(key text pk, value jsonb)` */
export type SettingRow = {
  key: "visibility" | "protocol_version" | "goal" | (string & {});
  value: Json;
};

/** The settings rows folded into one object. */
export type SwarmSettings = {
  visibility?: Visibility;
  protocol_version?: string;
  goal?: GoalSetting;
};

export type SessionStatus = "working" | "ended" | "abandoned";

/** `swarm_sessions` */
export type SessionRow = {
  id: string;
  agent: string | null;
  role: string | null;
  target: string | null;
  issue: number | null;
  pr: number | null;
  status: SessionStatus;
  summary: string | null;
  started_at: string;
  last_seen_at: string | null;
  ended_at: string | null;
};

/** `swarm_progress` */
export type ProgressRow = {
  id: number;
  session_id: string;
  note: string;
  created_at: string;
};

/** `swarm_retros` */
export type RetroRow = {
  id: number;
  session_id: string;
  role: string | null;
  protocol_version: string | null;
  went_well: string | null;
  friction: string | null;
  suggestion: string | null;
  created_at: string;
};

export type MessageKind = "question" | "proposal" | "handoff" | "answer" | "note";

/** `swarm_messages` */
export type MessageRow = {
  id: number;
  thread_id: number | null;
  session_id: string | null;
  author: string | null;
  kind: MessageKind;
  ref: string | null;
  topic: string | null;
  body: string;
  created_at: string;
};

/** One entry of `swarm_results.details.checks` in `checks` mode. */
export type CheckOutcome = {
  name: string;
  passed: boolean;
  exitCode?: number | null;
  durationMs?: number | null;
};

/** `swarm_results`: one referee run. Never assume a score exists. */
export type ResultRow = {
  id: number;
  session_id: string | null;
  target: string | null;
  issue: number | null;
  pr: number | null;
  commit_sha: string | null;
  baseline_sha: string | null;
  /** 'score' | 'checks' | 'review'. Null on rows written before modes existed. */
  mode: MeasureMode | null;
  candidate_score: number | null;
  baseline_score: number | null;
  delta: number | null;
  direction: string | null;
  margin: number | null;
  passed: boolean | null;
  details: Json | null;
  created_at: string;
};

/** `swarm_versions`: shipped versions. */
export type VersionRow = {
  id: number;
  target: string | null;
  version: string;
  score: number | null;
  pr: number | null;
  commit_sha: string | null;
  notes: string | null;
  created_at: string;
};

/** `swarm_buried` */
export type BuriedRow = {
  id: number;
  target: string | null;
  issue: number | null;
  pr: number | null;
  idea: string;
  concept: string | null;
  reason: string | null;
  lesson: string | null;
  numbers: Json | null;
  created_at: string;
};

/** `swarm_concepts` */
export type ConceptRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type TrialOutcome = "gained" | "lost" | "neutral";

/** `swarm_concept_trials` */
export type ConceptTrialRow = {
  id: number;
  concept_id: string;
  target: string;
  outcome: TrialOutcome;
  delta: number | null;
  ref: string | null;
  created_at: string;
};

/** `swarm_protocol_changes` */
export type ProtocolChangeRow = {
  id: number;
  version: string;
  issue: number | null;
  pr: number | null;
  summary: string;
  kept: boolean | null;
  created_at: string;
};

/** View `swarm_metrics`: one row. */
export type MetricsRow = {
  protocol_version: string | null;
  shipped: number | null;
  buried: number | null;
  ship_rate: number | null;
  median_claim_to_close_minutes: number | null;
  progress_per_session: number | null;
  retros_since_change: number | null;
  sessions_working: number | null;
};

/** View `swarm_fleet`: working sessions seen in the last 2 h. */
export type FleetRow = SessionRow & {
  latest_note: string | null;
  latest_note_at: string | null;
};

/** Every table and view the UI reads, by name. */
export type SwarmTables = {
  swarm_settings: SettingRow;
  swarm_sessions: SessionRow;
  swarm_progress: ProgressRow;
  swarm_retros: RetroRow;
  swarm_messages: MessageRow;
  swarm_results: ResultRow;
  swarm_versions: VersionRow;
  swarm_buried: BuriedRow;
  swarm_concepts: ConceptRow;
  swarm_concept_trials: ConceptTrialRow;
  swarm_protocol_changes: ProtocolChangeRow;
  swarm_metrics: MetricsRow;
  swarm_fleet: FleetRow;
};

export type SwarmTable = keyof SwarmTables;
