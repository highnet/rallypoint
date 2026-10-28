import type { Metadata } from "next";
import Link from "next/link";

import { CommandCopy } from "@/components/command-copy";
import { ImprovementCycle } from "@/components/improvement-cycle";
import { SignalFlag } from "@/components/signal-flag";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { LabelTable } from "@/components/state-lines";
import { agents } from "@/lib/agents";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "The Rallypoint protocol: rules, nine role boundaries, labels, self-improvement, installation, and how to prompt each role.",
};

const orchestratorPrompt =
  "Read AGENTS.md, then read .rallypoint/roles/orchestrator.md. Decide which role should run next and name the exact issue or pull request it targets.";

const rolePrompts = agents.map((agent) => ({
  slug: agent.slug,
  role: agent.name,
  prompt:
    agent.slug === "orchestrator"
      ? orchestratorPrompt
      : `Read AGENTS.md, then read .rallypoint/roles/${agent.slug}.md and follow it exactly.`,
}));

const humanPrompts = [
  {
    label: "A simple, polite ask",
    prompt: "Could you grab the next ready issue and ship it? Thanks!",
  },
  {
    label: "With extra context the role file doesn’t need",
    prompt:
      "A couple of users got stuck on the auth step in yesterday's onboarding call — can you check the backlog reflects that, add whatever's missing, and reprioritize anything blocking a fix?",
  },
  {
    label: "Chained into one message",
    prompt:
      "Run the planner to top up the backlog, then have a worker pick up whatever's highest priority, and kick off review as soon as that PR is open.",
  },
  {
    label: "Several roles at once",
    prompt:
      "Spin up three workers in parallel on the three oldest ready issues, and have a reviewer standing by for whichever one finishes first.",
  },
  {
    label: "On a schedule",
    prompt:
      "Set this up to loop: run the janitor every morning to clear stale claims, and have the orchestrator check in every few hours to tell me what's next.",
  },
];

const rules = [
  "One issue, one branch, one pull request.",
  "A worker claims exactly one claimable issue before editing code.",
  "A reviewer never approves work produced by the same agent.",
  "The repository and GitHub API are the only coordination state.",
  "Every role has explicit GitHub permissions and explicit prohibitions.",
  "Failed checks and requested changes stay with the current issue.",
  "The loop changes its own prompts one measured change at a time, and never its own judge.",
];

const toc = [
  { href: "#principles", label: "Principles" },
  { href: "#roles", label: "Role boundaries" },
  { href: "#labels", label: "Labels" },
  { href: "#self-improvement", label: "Self-improvement" },
  { href: "#install", label: "Install" },
  { href: "#prompting", label: "Prompting" },
];

export default function DocsPage() {
  return (
    <>
      <SiteHeader current="/docs" />
      <main className="docs" id="main">
        <div className="docs-intro">
          <h1>A repository protocol agents can actually follow.</h1>
          <p className="lede">
            Rallypoint does not run your models. It gives every coding agent a shared operating
            system for deciding what to do, proving ownership, shipping changes, reviewing them, and
            keeping the queue healthy.
          </p>
        </div>

        <div className="docs-layout">
          <nav aria-label="On this page" className="docs-toc">
            <p>On this page</p>
            <ol>
              {toc.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="docs-body">
            <section aria-labelledby="principles-title" className="docs-section" id="principles">
              <h2 id="principles-title">Principles</h2>
              <ol className="rule-list">
                {rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="roles-title" className="docs-section" id="roles">
              <h2 id="roles-title">Role boundaries</h2>
              <p>
                Every session adopts exactly one role. The orchestrator decides which role a new
                session should adopt by reading repository state; every other role then works within
                its own boundary alone.
              </p>
              <div className="table-wrap">
                <table className="code-table">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Claims?</th>
                      <th scope="col">Reviews?</th>
                      <th scope="col">Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.slug}>
                        <th scope="row">
                          <Link className="role-cell" href={`/agents/${agent.slug}`}>
                            <SignalFlag className="role-flag" signal={agent.slug} />
                            <span>{agent.name}</span>
                          </Link>
                        </th>
                        <td data-label="Claims">{agent.claims}</td>
                        <td data-label="Reviews">{agent.reviews}</td>
                        <td data-label="Purpose">{agent.responsibility}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="labels-title" className="docs-section" id="labels">
              <h2 id="labels-title">Labels</h2>
              <p>
                Labels are state, and their names are configurable in{" "}
                <code>.rallypoint/config.json</code>. An open issue is claimable unless something holds
                it back: no assignee and none of <code>status:claimed</code>,{" "}
                <code>status:blocked</code>, <code>status:deferred</code> or <code>needs:human</code>.
                There is no readiness label.
              </p>
              <LabelTable />
            </section>

            <section
              aria-labelledby="self-improvement-title"
              className="docs-section"
              id="self-improvement"
            >
              <h2 id="self-improvement-title">Self-improvement</h2>
              <p>
                Rallypoint is a self-improving graph. The improver reads the loop’s own history,
                proposes one change to one role prompt labelled <code>loop:improvement</code>, and
                keeps it only when <code>improvement.mjs evaluate</code> finds the named metric improved
                over equal samples before and after the merge, with the named counter-metric and
                unreviewed merges no worse. Scripts, <code>.rallypoint/config.json</code>, the protocol
                documents and the reviewer’s, merger’s and improver’s prompts are frozen to it; what
                “better” means stays with the repository’s owners.
              </p>
              <ImprovementCycle />
            </section>

            <section aria-labelledby="install-title" className="docs-section" id="install">
              <h2 id="install-title">Install</h2>
              <p>
                Rallypoint’s CLI reads its own checksummed manifest and writes each file to an
                explicit repository-root path. It stops on conflicts rather than overwriting anything
                silently. An existing <code>AGENTS.md</code> gets special handling: it is left
                untouched, the rest of the loop still installs, and the CLI suggests adding a one-line{" "}
                <code>@AGENTIC_LOOP.md</code> reference to it.
              </p>
              <div className="docs-commands">
                <CommandCopy command="npx rallypoint@latest view loop" id="docs-view" />
                <CommandCopy command="npx rallypoint@latest add loop" id="docs-install" label="install command" />
                <CommandCopy command="npx rallypoint@latest init" id="docs-init" label="init command" />
              </div>
              <p>
                <code>init</code> requires the GitHub CLI, installed and authenticated. It syncs the
                configured integration branch to the repository’s default branch, creates the labels
                the loop reads and writes, and reports — without changing — whether the default branch
                has protection rules.
              </p>
            </section>

            <section aria-labelledby="prompting-title" className="docs-section" id="prompting">
              <h2 id="prompting-title">Prompting</h2>
              <p>
                A role is one file, so at minimum, prompting an agent to become that role means
                pointing a fresh session at <code>AGENTS.md</code> and exactly one file under{" "}
                <code>.rallypoint/roles/</code>. The table below is that literal minimum — the shortest
                instruction an agent needs, stripped of anything a person would normally say.
              </p>
              <p>
                Don’t know what should happen next? Prompt the orchestrator first. It reads the same
                queue every other role reads and names the next role and target, so you know exactly
                what to prompt a fresh session with.
              </p>
              <CommandCopy
                command={orchestratorPrompt}
                id="docs-prompt-orchestrator"
                label="orchestrator prompt"
                shell={false}
              />
              <div className="table-wrap">
                <table className="code-table prompt-table">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Prompt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolePrompts.map(({ slug, role, prompt }) => (
                      <tr key={role}>
                        <th scope="row">
                          <span className="role-cell">
                            <SignalFlag className="role-flag" signal={slug} />
                            <span>{role}</span>
                          </span>
                        </th>
                        <td data-label="Prompt">
                          <code>{prompt}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>How a person actually asks</h3>
              <p>
                Nobody talks like the table above. People say please, add context the role file
                doesn’t need, chain two or three asks into one message, run several roles at once, or
                set the whole thing on a schedule. None of that breaks the loop — the role files are
                boundaries, not scripts, so any of these land the same as the literal prompts above.
              </p>
              <ul className="prompt-examples">
                {humanPrompts.map(({ label, prompt }) => (
                  <li key={label}>
                    <p className="prompt-label">{label}</p>
                    <blockquote>{prompt}</blockquote>
                  </li>
                ))}
              </ul>
            </section>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
