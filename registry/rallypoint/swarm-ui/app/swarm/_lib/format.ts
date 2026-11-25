import { swarmConfig } from "../swarm.config";
import type { SwarmVocabulary } from "./config-types";
import type { CheckOutcome, Json, ResultRow } from "./types";

/** A vocabulary word, optionally capitalised: `word("shipped", true)` → "Shipped". */
export function word(key: keyof SwarmVocabulary, capitalise = false): string {
  const value = swarmConfig.vocabulary[key] ?? key;
  return capitalise ? cap(value) : value;
}

export function cap(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : numberFormat.format(value);
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const unit = swarmConfig.measure.unit;
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${formatNumber(Math.abs(value))}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const ratio = value > 1 ? value / 100 : value;
  return `${Math.round(ratio * 100)}%`;
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${formatNumber(Math.round(hours * 10) / 10)} h`;
  return `${formatNumber(Math.round((hours / 24) * 10) / 10)} d`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 120) return `${formatNumber(Math.round(seconds * 10) / 10)} s`;
  return `${formatNumber(Math.round(seconds / 6) / 10)} min`;
}

const dateFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const shortDate = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

export function formatShortDate(iso: string | number): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : shortDate.format(date);
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} d ago`;
  return formatShortDate(iso);
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

/** `details.checks` from a checks-mode referee run, when present and well formed. */
export function checksOf(result: Pick<ResultRow, "details">): CheckOutcome[] {
  const details = result.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const checks = (details as Record<string, Json>).checks;
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((check) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) return [];
    const record = check as Record<string, Json>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        passed: record.passed === true,
        exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
        durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
      },
    ];
  });
}

/** The mode a result row was judged in, falling back to details.mode. */
export function resultMode(result: Pick<ResultRow, "mode" | "details" | "candidate_score">): string {
  if (result.mode) return result.mode;
  const details = result.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const mode = (details as Record<string, Json>).mode;
    if (typeof mode === "string") return mode;
  }
  return result.candidate_score !== null ? "score" : "checks";
}

/** A flat list of key/value pairs from a jsonb object, for display. */
export function jsonEntries(value: Json | null): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).map(([key, entry]) => [
    key,
    typeof entry === "number" ? formatNumber(entry) : typeof entry === "string" ? entry : JSON.stringify(entry),
  ]);
}
