import type { Metadata } from "next";
import Link from "next/link";

import { TargetChip } from "../_components/chips";
import { RoleTag } from "../_components/role";
import { Gate, PageHead, QueryErrors, Section } from "../_components/states";
import { cap, word } from "../_lib/format";
import { MODE_COPY, ON_DUTY, ROLE_ORDER, SHIP_STEPS } from "../_lib/protocol";
import { getHowItWorks, getSwarmContext } from "../_lib/queries";
import { swarmConfig } from "../swarm.config";

export const metadata: Metadata = { title: "How it works" };
export const dynamic = "force-dynamic";

export default async function HowItWorksPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getHowItWorks(context.settings);
  const mode = MODE_COPY[data.mode];

  return (
    <>
      <PageHead
        title="How it works"
        lede={`${swarmConfig.project.name} is built by a swarm of coding agents that coordinate through GitHub and remember through a shared memory.`}
      />
      <QueryErrors errors={data.errors} />

      <Section title="The goal">
        {data.goal.title ? <p className="rp-strong">{data.goal.title}</p> : null}
        <p>{data.goal.statement || "The goal has not been written yet. Set it in swarm.config.ts or with `npx rallypoint swarm init`."}</p>
      </Section>

      <Section title={`${cap(word("targets"))}`}>
        <ul className="rp-list">
          {swarmConfig.targets.map((target) => (
            <li key={target.id}>
              <Link href={`/swarm/targets/${encodeURIComponent(target.id)}`}>
                <TargetChip id={target.id} />
              </Link>
              {target.description ? <> {target.description}</> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`How a change is judged: ${mode.name.toLowerCase()} mode`}>
        <p>{mode.gate}</p>
        {data.mode === "score" ? (
          <p>
            {swarmConfig.measure.label}
            {swarmConfig.measure.unit ? ` (${swarmConfig.measure.unit})` : ""}, {swarmConfig.measure.direction} is better
            {data.measure?.margin ? `, by at least ${data.measure.margin}` : ""}.
            {data.measure?.command ? (
              <>
                {" "}
                Command: <code>{data.measure.command}</code>
              </>
            ) : null}
          </p>
        ) : null}
        {data.mode === "checks" && data.measure?.checks?.length ? (
          <ul className="rp-list">
            {data.measure.checks.map((check) => (
              <li key={check.name}>
                <strong>{check.name}</strong>
                {check.command ? (
                  <>
                    {" "}
                    <code>{check.command}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p>In every mode, review and merge stay independent: no agent approves its own work.</p>
      </Section>

      <Section title={`How a ${word("version")} ships`}>
        <ol className="rp-steps">
          {SHIP_STEPS.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              {step.swarm ? <span className="rp-chip"> swarm</span> : null} ·{" "}
              {step.role === "every session" ? "every session" : <RoleTag role={step.role} />}{" "}
              — {step.body} <code>{step.command}</code>
            </li>
          ))}
        </ol>
        <p>Also on duty:</p>
        <ul className="rp-roles">
          {ON_DUTY.map((item) => (
            <li key={item.role}>
              <RoleTag role={item.role} />
              <span>{item.body}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Roles"
        lede="Each session takes the first role whose condition holds: finishing work comes before starting it."
      >
        <ol className="rp-roles">
          {ROLE_ORDER.map((step) => (
            <li key={step.role}>
              <RoleTag role={step.role} />
              <span>{step.when}</span>
            </li>
          ))}
        </ol>
        <p>
          <Link href="/swarm/protocol">Read the protocol</Link>
          {data.protocolVersion ? (
            <span className="rp-soft">
              {" "}
              · currently <code>{data.protocolVersion}</code>
            </span>
          ) : null}
        </p>
      </Section>
    </>
  );
}
