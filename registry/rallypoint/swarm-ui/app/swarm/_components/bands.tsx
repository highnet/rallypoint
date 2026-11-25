import Link from "next/link";
import type { ReactNode } from "react";

import type { SwarmTarget } from "../_lib/config-types";
import { cap, formatNumber, formatPercent, word } from "../_lib/format";
import type { TargetSummary } from "../_lib/queries";
import { swarmConfig } from "../swarm.config";
import { ArrowIcon, TargetMark, targetStyle } from "./icons";

/**
 * The page bands of the overview: a hero, full-width sections with large
 * headings, target cards and numbered steps. Every word comes from
 * swarm.config.ts or from memory.
 */

/** A text link with a trailing arrow, for "next" actions. */
export function NextLink({ href, children, out }: { href: string; children: ReactNode; out?: boolean }) {
  return (
    <Link className="rp-next" href={href}>
      {children}
      <ArrowIcon out={out} />
    </Link>
  );
}

export function Hero({
  note,
  title,
  lede,
  actions,
  backdrop = true,
}: {
  /** A quiet line under the lede, e.g. how the goal is measured. */
  note?: ReactNode;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  backdrop?: boolean;
}) {
  return (
    <header className="rp-hero">
      {backdrop ? <HeroBackdrop targets={swarmConfig.targets} /> : null}
      <div className="rp-hero-inner">
        <h1>{title}</h1>
        {lede ? <p className="rp-hero-lede">{lede}</p> : null}
        {note ? <p className="rp-hero-note">{note}</p> : null}
        {actions ? <div className="rp-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Receding planes, one per target (up to three), tinted with the target's
 * colour. Decorative only.
 */
function HeroBackdrop({ targets }: { targets: SwarmTarget[] }) {
  const planes = (targets.length > 0 ? targets : [{ id: "_", name: "", color: "var(--rp-ink-soft)", description: "" }]).slice(0, 3);
  return (
    <div aria-hidden="true" className="rp-hero-backdrop">
      {planes.map((target, index) => (
        <span className={`rp-plane rp-plane-${index + 1}`} key={target.id} style={targetStyle(target)} />
      ))}
    </div>
  );
}

/** A full-width band with a large heading. `tone` alternates the ground. */
export function Band({
  title,
  lede,
  id,
  tone,
  action,
  children,
}: {
  title: string;
  lede?: ReactNode;
  id?: string;
  tone?: "sunk";
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = id ?? `b-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className={tone === "sunk" ? "rp-band rp-band-sunk" : "rp-band"}>
      <div className="rp-band-inner">
        <h2 className="rp-band-title" id={headingId}>
          {title}
        </h2>
        {lede ? <p className="rp-band-lede">{lede}</p> : null}
        {action ? <p className="rp-band-action">{action}</p> : null}
        {children}
      </div>
    </section>
  );
}

/**
 * One target as a card: its mark and name, the headline figure (the latest
 * score in score mode, versions shipped otherwise), the latest version and a
 * line on what the record says next.
 */
export function TargetCard({ entry, headingLevel = 3 }: { entry: TargetSummary; headingLevel?: 2 | 3 }) {
  const { target, latest } = entry;
  const href = `/swarm/targets/${encodeURIComponent(target.id)}`;
  const score = swarmConfig.measure.mode === "score";
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headline = score
    ? { label: swarmConfig.measure.label || cap(word("score")), value: formatNumber(latest?.score ?? null), unit: swarmConfig.measure.unit }
    : { label: `${cap(word("versions"))} ${word("shipped")}`, value: formatNumber(entry.versions), unit: "" };

  let next: ReactNode;
  if (entry.results === 0 && entry.versions === 0) {
    next = (
      <>
        Nothing measured yet. The first {word("result")} lands when an {word("agent")} runs{" "}
        <code>npx rallypoint swarm referee --target {target.id}</code>.
      </>
    );
  } else {
    const parts = [`${formatNumber(entry.passed)} of ${formatNumber(entry.results)} ${word(entry.results === 1 ? "result" : "results")} passed`];
    if (entry.buried > 0) parts.push(`${formatNumber(entry.buried)} ${word(entry.buried === 1 ? "idea" : "ideas")} ${word("buried")}`);
    if (entry.delivery && entry.delivery.total > 0) {
      parts.push(`${formatPercent(entry.delivery.merged / entry.delivery.total)} of issues merged`);
    }
    next = `${parts.join(" · ")}.`;
  }

  return (
    <article className="rp-tcard" style={targetStyle(target)}>
      <header className="rp-tcard-head">
        <TargetMark size="l" target={target} />
        <div>
          <Heading className="rp-tcard-name">
            <Link className="rp-cover" href={href}>
              {target.name}
            </Link>
          </Heading>
          {target.description ? <p className="rp-tcard-desc">{target.description}</p> : null}
        </div>
        <ArrowIcon />
      </header>
      <dl className="rp-tcard-figs">
        <div>
          <dt>{headline.label}</dt>
          <dd className="rp-big">
            {headline.value}
            {headline.unit && headline.value !== "—" ? <span className="rp-unit">{headline.unit}</span> : null}
          </dd>
        </div>
        <div>
          <dt>{cap(word("version"))}</dt>
          <dd className="rp-mid">{latest?.version ?? "—"}</dd>
        </div>
      </dl>
      <p className="rp-tcard-next">{next}</p>
    </article>
  );
}

/** Numbered steps, two columns on wide screens. */
export function Steps({ steps }: { steps: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="rp-steps-list">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span aria-hidden="true" className="rp-step-n">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
