import { ArrowLeft, ArrowRight, Check, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CampaignBackground } from "@/components/campaign-background";
import { CommandCopy } from "@/components/command-copy";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { agentFieldGuides, agents, getAgent } from "@/lib/agents";
import { cn } from "@/lib/utils";

type AgentPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return agents.map((agent) => ({ slug: agent.slug }));
}

export async function generateMetadata({ params }: AgentPageProps): Promise<Metadata> {
  const agent = getAgent((await params).slug);
  return agent
    ? {
        title: `${agent.name} — ${agent.title}`,
        description: agent.summary,
      }
    : {};
}

export default async function AgentPage({ params }: AgentPageProps) {
  const agent = getAgent((await params).slug);
  if (!agent) notFound();

  const index = agents.findIndex((item) => item.slug === agent.slug);
  const nextAgent = agents[(index + 1) % agents.length];
  const fieldGuide = agentFieldGuides[agent.slug];

  return (
    <main className="agent-page">
      <section className={`agent-hero agent-${agent.color}`}>
        <CampaignBackground focus={index} variant="agent" />
        <header className="site-header">
          <Wordmark />
          <nav aria-label="Agent page navigation">
            <Link href="/#loop">The loop</Link>
            <Link href="/#party">All roles</Link>
            <Link href="/docs">Docs</Link>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <MobileNav />
          </div>
        </header>
        <div className="agent-hero-content">
          <Link className="back-link" href="/#party">
            <ArrowLeft />
            Back to the party
          </Link>
          <p className="agent-index">Role contract · {String(index + 1).padStart(2, "0")}</p>
          <h1>{agent.name}</h1>
          <p className="agent-title">{agent.title}</p>
          <p className="agent-summary">{agent.summary}</p>
        </div>
      </section>

      <section className="agent-field-guide" aria-labelledby="field-guide-title">
        <div className="field-guide-heading">
          <p>Field identification</p>
          <h2 id="field-guide-title">Know the role before you summon it.</h2>
        </div>
        <dl>
          <div>
            <dt>Habitat</dt>
            <dd>{fieldGuide.habitat}</dd>
            <dd className="field-guide-note">{fieldGuide.habitatDetail}</dd>
          </div>
          <div>
            <dt>Quest capacity</dt>
            <dd>{fieldGuide.capacity}</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>{fieldGuide.authority}</dd>
          </div>
          <div>
            <dt>Required yield</dt>
            <dd>{fieldGuide.yield}</dd>
          </div>
          <div>
            <dt>Field kit</dt>
            <dd>{fieldGuide.fieldKit}</dd>
          </div>
        </dl>
      </section>

      <section className="agent-contract">
        <div className="contract-column">
          <div className="contract-heading">
            <Check aria-hidden="true" />
            <h2>What this agent does</h2>
          </div>
          <ol>
            {agent.does.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>
        <div className="contract-column contract-never">
          <div className="contract-heading">
            <ShieldX aria-hidden="true" />
            <h2>Hard boundaries</h2>
          </div>
          <ul>
            {agent.never.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <aside className="handoff-sheet">
          <p>Required handoff</p>
          <h2>{agent.handoff}</h2>
          <CommandCopy
            command={`cat .rallypoint/roles/${agent.slug}.md`}
            id={`role-${agent.slug}`}
          />
        </aside>
      </section>

      <section className="next-role">
        <div>
          <p>The loop continues</p>
          <h2>Meet {nextAgent.name}, {nextAgent.title.toLowerCase()}.</h2>
        </div>
        <Link
          className={cn(buttonVariants({ variant: "quest", size: "lg" }))}
          href={`/agents/${nextAgent.slug}`}
        >
          Next role
          <ArrowRight />
        </Link>
      </section>
    </main>
  );
}
