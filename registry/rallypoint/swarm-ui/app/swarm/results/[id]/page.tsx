import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IssuePr, TargetChip, Verdict } from "../../_components/chips";
import { RoleTag } from "../../_components/role";
import { ChecksList, ResultOutcome } from "../../_components/results";
import { Gate, PageHead, QueryErrors, Section } from "../../_components/states";
import {
  cap,
  formatDate,
  formatDelta,
  formatNumber,
  formatScore,
  jsonEntries,
  resultMode,
  shortSha,
  word,
} from "../../_lib/format";
import { getResult, getSwarmContext } from "../../_lib/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${cap(word("result"))} #${id}` };
}

export default async function ResultPage({ params }: Props) {
  const { id } = await params;
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getResult(id);
  if (!data) notFound();
  if (!data.result) return <QueryErrors errors={data.errors} />;
  const { result, session } = data;
  const mode = resultMode(result);
  const details = jsonEntries(result.details).filter(([key]) => key !== "checks");

  return (
    <>
      <PageHead title={`${cap(word("result"))} #${result.id}`}>
        <p>
          <Verdict passed={result.passed} /> · <TargetChip id={result.target} /> ·{" "}
          {formatDate(result.created_at)}
        </p>
      </PageHead>
      <QueryErrors errors={data.errors} />

      <dl className="rp-facts">
        <div>
          <dt>Mode</dt>
          <dd>{mode}</dd>
        </div>
        <div>
          <dt>Measured</dt>
          <dd>
            <ResultOutcome result={result} />
          </dd>
        </div>
        <div>
          <dt>Issue / PR</dt>
          <dd>
            <IssuePr issue={result.issue} pr={result.pr} />
          </dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd className="rp-mono">{shortSha(result.commit_sha)}</dd>
        </div>
        <div>
          <dt>Baseline</dt>
          <dd className="rp-mono">{shortSha(result.baseline_sha)}</dd>
        </div>
        {mode === "score" ? (
          <>
            <div>
              <dt>Candidate</dt>
              <dd>{formatScore(result.candidate_score)}</dd>
            </div>
            <div>
              <dt>Baseline score</dt>
              <dd>{formatScore(result.baseline_score)}</dd>
            </div>
            <div>
              <dt>Delta</dt>
              <dd>{formatDelta(result.delta)}</dd>
            </div>
            <div>
              <dt>Needed</dt>
              <dd>
                {result.direction ?? "—"} by {formatNumber(result.margin)}
              </dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>{cap(word("session"))}</dt>
          <dd>
            {session ? (
              <>
                <span className="rp-mono">{session.agent ?? "—"}</span> · <RoleTag role={session.role} />
              </>
            ) : (
              <span className="rp-soft">—</span>
            )}
          </dd>
        </div>
      </dl>

      {mode === "checks" ? (
        <Section title="Checks">
          <ChecksList result={result} />
        </Section>
      ) : null}

      {details.length > 0 ? (
        <Section title="Details">
          <dl className="rp-facts">
            {details.map(([key, value]) => (
              <div key={key}>
                <dt>
                  <code>{key}</code>
                </dt>
                <dd className="rp-break">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <p>
        <Link href="/swarm/results">All {word("results")}</Link>
      </p>
    </>
  );
}
