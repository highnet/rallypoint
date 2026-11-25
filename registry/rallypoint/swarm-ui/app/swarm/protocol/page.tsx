import type { Metadata } from "next";

import { IssuePr, Verdict } from "../_components/chips";
import { RoleTag } from "../_components/role";
import { Empty, Figures, Gate, PageHead, QueryErrors, Section, TimeAgo } from "../_components/states";
import { cap, formatMinutes, formatNumber, formatPercent, word } from "../_lib/format";
import { ROLE_ORDER, RULES, START_PROMPTS } from "../_lib/protocol";
import { getProtocol, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: "Protocol" };
export const dynamic = "force-dynamic";

export default async function ProtocolPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getProtocol(context.settings);
  const m = data.metrics;

  return (
    <>
      <PageHead
        title="Protocol"
        lede="The rules the swarm works by, and how it changes them. Each session does one job, another agent checks every change, and each session leaves a retro for the next improvement."
      />
      <QueryErrors errors={data.errors} />

      <Section title="How it is doing">
        <Figures
          items={[
            { label: "Protocol version", value: <code>{data.protocolVersion ?? "—"}</code> },
            { label: "Ship rate", value: formatPercent(m?.ship_rate) },
            { label: "Claim → close (median)", value: formatMinutes(m?.median_claim_to_close_minutes) },
            { label: `Progress notes per ${word("session")}`, value: formatNumber(m?.progress_per_session) },
            { label: "Retros since the last change", value: formatNumber(m?.retros_since_change) },
          ]}
        />
      </Section>

      <Section title="Start a session" lede="Paste one into a new coding-agent session on the repository. Each is self-contained.">
        <ul className="rp-prompts">
          {START_PROMPTS.map((prompt) => (
            <li key={prompt.title}>
              <h3>{prompt.title}</h3>
              <p className="rp-soft">{prompt.when}</p>
              <pre className="rp-code">{data.repoUrl ? `Repository: ${data.repoUrl}\n${prompt.prompt}` : prompt.prompt}</pre>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Rules that do not bend">
        <ol className="rp-steps">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </Section>

      <Section title="Roles, in the order a session takes them">
        <ol className="rp-roles">
          {ROLE_ORDER.map((step) => (
            <li key={step.role}>
              <RoleTag role={step.role} />
              <span>{step.when}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="How it changes"
        lede="The improver turns retros into one protocol change at a time. Each is kept or reverted on the metrics."
      >
        {data.changes.length === 0 ? (
          <Empty>No protocol changes yet.</Empty>
        ) : (
          <table className="rp-table rp-reflow">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Change</th>
                <th scope="col">Issue / PR</th>
                <th scope="col">Outcome</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {data.changes.map((change) => (
                <tr key={change.id}>
                  <td className="rp-mono" data-label="Version">
                    {change.version}
                  </td>
                  <td data-label="Change">{change.summary}</td>
                  <td data-label="Issue / PR">
                    <IssuePr issue={change.issue} pr={change.pr} />
                  </td>
                  <td data-label="Outcome">
                    <Verdict labels={["kept", "reverted"]} passed={change.kept} />
                  </td>
                  <td data-label="When">
                    <TimeAgo at={change.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <p className="rp-soft">{cap(word("sessions"))} working now: {formatNumber(m?.sessions_working)}</p>
    </>
  );
}
