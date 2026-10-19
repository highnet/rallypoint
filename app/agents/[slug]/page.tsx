import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CommandCopy } from "@/components/command-copy";
import { SignalFlag } from "@/components/signal-flag";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { agents, getAgent } from "@/lib/agents";
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
        title: `${agent.name} role`,
        description: agent.summary,
      }
    : {};
}

export default async function AgentPage({ params }: AgentPageProps) {
  const agent = getAgent((await params).slug);
  if (!agent) notFound();

  const index = agents.findIndex((item) => item.slug === agent.slug);
  const nextAgent = agents[(index + 1) % agents.length];
  const prompt =
    agent.slug === "orchestrator"
      ? "Read AGENTS.md, then read .rallypoint/roles/orchestrator.md. Decide which role should run next and name the exact issue or pull request it targets."
      : `Read AGENTS.md, then read .rallypoint/roles/${agent.slug}.md and follow it exactly.`;

  return (
    <>
      <SiteHeader />
      <main className="contract" id="main">
        <nav aria-label="All roles" className="role-strip">
          <Link className="text-link back-link" href="/#roles">
            <ArrowLeft aria-hidden="true" /> All roles
          </Link>
          <ol>
            {agents.map((item) => (
              <li key={item.slug}>
                <Link
                  aria-current={item.slug === agent.slug ? "page" : undefined}
                  className={cn(item.slug === agent.slug && "is-current")}
                  href={`/agents/${item.slug}`}
                >
                  <SignalFlag className="strip-flag" signal={item.slug} />
                  <span>{item.name}</span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <header className="contract-head">
          <SignalFlag className="contract-flag" signal={agent.slug} />
          <div className="contract-title">
            <p className="contract-file">
              <code>.rallypoint/roles/{agent.slug}.md</code>
            </p>
            <h1>{agent.name}</h1>
            <p className="lede">{agent.summary}</p>
          </div>
          <dl className="contract-spec">
            <div>
              <dt>Claims issues</dt>
              <dd>{agent.claims}</dd>
            </div>
            <div>
              <dt>Reviews</dt>
              <dd>{agent.reviews}</dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>{agent.capacity}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{agent.authority}</dd>
            </div>
            <div>
              <dt>Yields</dt>
              <dd>{agent.yield}</dd>
            </div>
          </dl>
        </header>

        <section aria-label="Contract" className="contract-body">
          <div className="contract-col">
            <h2>Does</h2>
            <ol className="does-list">
              {agent.does.map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="contract-col contract-never">
            <h2>Never</h2>
            <ul className="never-list">
              {agent.never.map((item) => (
                <li key={item}>
                  <X aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="handoff-title" className="handoff">
          <div className="handoff-inner">
            <h2 id="handoff-title">Hands off</h2>
            <p className="handoff-text">{agent.handoff}</p>
            <div className="handoff-commands">
              <p>Start a fresh session as the {agent.name.toLowerCase()}:</p>
              <CommandCopy command={prompt} id={`prompt-${agent.slug}`} label="prompt" shell={false} />
              <CommandCopy
                command={`cat .rallypoint/roles/${agent.slug}.md`}
                id={`role-${agent.slug}`}
              />
            </div>
          </div>
        </section>

        <nav aria-label="Next role" className="next-role">
          <Link href={`/agents/${nextAgent.slug}`}>
            <span className="next-label">Next role</span>
            <span className="next-name">
              <SignalFlag className="next-flag" signal={nextAgent.slug} />
              {nextAgent.name}
              <ArrowRight aria-hidden="true" />
            </span>
            <span className="next-summary">{nextAgent.summary}</span>
          </Link>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
