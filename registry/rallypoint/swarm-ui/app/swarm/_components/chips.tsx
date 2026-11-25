import type { CSSProperties } from "react";

import { githubRefUrl } from "../_lib/github";
import { findTarget } from "../_lib/queries";
import type { MessageKind, SessionStatus, TrialOutcome } from "../_lib/types";

/** A target: its colour swatch, always beside its name. */
export function TargetChip({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="rp-soft">—</span>;
  const target = findTarget(id);
  const style = { "--rp-target": target?.color ?? "var(--rp-ink-soft)" } as CSSProperties;
  return (
    <span className="rp-target" style={style}>
      <span aria-hidden="true" className="rp-target-swatch" />
      <span>{target?.name ?? id}</span>
    </span>
  );
}

/** GitHub picks black or white label text by the background's luminance. */
function labelText(hex: string): string {
  const clean = /^[0-9a-f]{6}$/i.test(hex) ? hex : "ededed";
  const channel = (offset: number) => {
    const c = parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.179 ? "#1f2328" : "#ffffff";
}

/** A GitHub label, rendered the way GitHub renders it. */
export function LabelChip({ name, color }: { name: string; color: string }) {
  const hex = /^[0-9a-f]{6}$/i.test(color) ? color : "ededed";
  const style = { "--rp-chip-bg": `#${hex}`, "--rp-chip-fg": labelText(hex) } as CSSProperties;
  return (
    <span className="rp-chip" style={style}>
      {name}
    </span>
  );
}

const kindSymbol: Record<MessageKind, string> = {
  question: "?",
  proposal: "→",
  handoff: "⇄",
  answer: "✓",
  note: "·",
};

export function KindChip({ kind }: { kind: MessageKind }) {
  return (
    <span className={`rp-tag rp-kind-${kind}`}>
      <span aria-hidden="true">{kindSymbol[kind] ?? "·"}</span> {kind}
    </span>
  );
}

/** Pass / fail, as a symbol and a word. */
export function Verdict({ passed, labels }: { passed: boolean | null; labels?: [string, string] }) {
  const [yes, no] = labels ?? ["passed", "failed"];
  if (passed === null) return <span className="rp-tag">… pending</span>;
  return passed ? (
    <span className="rp-tag rp-pass">
      <span aria-hidden="true">✓</span> {yes}
    </span>
  ) : (
    <span className="rp-tag rp-fail">
      <span aria-hidden="true">✗</span> {no}
    </span>
  );
}

const statusSymbol: Record<SessionStatus, string> = { working: "●", ended: "■", abandoned: "○" };

export function StatusTag({ status }: { status: SessionStatus }) {
  return (
    <span className={`rp-tag rp-status-${status}`}>
      <span aria-hidden="true">{statusSymbol[status] ?? "·"}</span> {status}
    </span>
  );
}

export const outcomeSymbol: Record<TrialOutcome, string> = { gained: "▲", lost: "▼", neutral: "●" };

export function Outcome({ outcome, count }: { outcome: TrialOutcome; count?: number }) {
  return (
    <span className={`rp-tag rp-outcome-${outcome}`}>
      <span aria-hidden="true">{outcomeSymbol[outcome]}</span> {outcome}
      {count && count > 1 ? ` ×${count}` : ""}
    </span>
  );
}

/** An issue or PR number, linked to GitHub when the repo is known. */
export function Ref({ value, prefix = "#" }: { value: number | string | null | undefined; prefix?: string }) {
  if (value === null || value === undefined || value === "") return <span className="rp-soft">—</span>;
  const text = typeof value === "number" ? `${prefix}${value}` : value;
  const href = githubRefUrl(value);
  return href ? (
    <a className="rp-mono" href={href} rel="noreferrer" target="_blank">
      {text}
    </a>
  ) : (
    <span className="rp-mono">{text}</span>
  );
}

/** "#12 · PR #34", or a dash. */
export function IssuePr({ issue, pr }: { issue: number | null; pr: number | null }) {
  if (issue === null && pr === null) return <span className="rp-soft">—</span>;
  return (
    <span className="rp-refs">
      {issue !== null ? <Ref value={issue} /> : null}
      {pr !== null ? (
        <span>
          PR <Ref value={pr} />
        </span>
      ) : null}
    </span>
  );
}
