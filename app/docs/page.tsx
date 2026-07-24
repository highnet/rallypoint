import {
  ArrowLeft,
  CircleDot,
  GitBranch,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { CommandCopy } from "@/components/command-copy";
import { DocsQuickNav } from "@/components/docs-quick-nav";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

const rolePrompts = [
  {
    role: "Orchestrator",
    prompt:
      "Read AGENTS.md, then read .rallypoint/roles/orchestrator.md. Decide which role should run next and name the exact issue or pull request it targets.",
  },
  {
    role: "Planner",
    prompt: "Read AGENTS.md, then read .rallypoint/roles/planner.md and follow it exactly.",
  },
  {
    role: "Worker",
    prompt: "Read AGENTS.md, then read .rallypoint/roles/worker.md and follow it exactly.",
  },
  {
    role: "Reviewer",
    prompt: "Read AGENTS.md, then read .rallypoint/roles/reviewer.md and follow it exactly.",
  },
  {
    role: "Tester",
    prompt: "Read AGENTS.md, then read .rallypoint/roles/tester.md and follow it exactly.",
  },
  {
    role: "Fixer",
    prompt: "Read AGENTS.md, then read .rallypoint/roles/fixer.md and follow it exactly.",
  },
  {
    role: "Janitor",
    prompt: "Read AGENTS.md, then read .rallypoint/roles/janitor.md and follow it exactly.",
  },
];

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
      "Run the planner to top up the ready queue, then have a worker pick up whatever's highest priority, and kick off review as soon as that PR is open.",
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
  "A worker claims exactly one ready issue before editing code.",
  "A reviewer never approves work produced by the same agent.",
  "The repository and GitHub API are the only coordination state.",
  "Every role has explicit GitHub permissions and explicit prohibitions.",
  "Failed checks and requested changes stay with the current quest.",
];

export default function DocsPage() {
  return (
    <main className="docs-page">
      <header className="site-header docs-header">
        <Wordmark />
        <nav aria-label="Documentation navigation">
          <a href="#principles">Principles</a>
          <a href="#roles">Roles</a>
          <a href="#install">Install</a>
          <a href="#prompting">Prompting</a>
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <MobileNav />
        </div>
      </header>

      <DocsQuickNav />

      <article className="docs-shell">
        <div className="docs-hero">
          <Link className="back-link" href="/">
            <ArrowLeft />
            Back to the campaign table
          </Link>
          <p className="docs-kicker">The Rallypoint Playbook</p>
          <h1>A repository protocol agents can actually follow.</h1>
          <p>
            Rallypoint does not run your models. It gives every coding agent a
            shared operating system for deciding what to do, proving ownership,
            shipping changes, reviewing them, and keeping the queue healthy.
          </p>
        </div>

        <section className="docs-section" id="principles">
          <div className="docs-section-title">
            <ShieldCheck />
            <h2>The party oath</h2>
          </div>
          <ol className="rule-list">
            {rules.map((rule, index) => (
              <li key={rule}>
                <span>{index + 1}</span>
                <p>{rule}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="docs-section" id="roles">
          <div className="docs-section-title">
            <CircleDot />
            <h2>Role boundaries</h2>
          </div>
          <div className="docs-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Claims?</th>
                  <th>Reviews?</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Planner</td>
                  <td>No</td>
                  <td>No</td>
                  <td>Grooms a ready backlog.</td>
                </tr>
                <tr>
                  <td>Worker</td>
                  <td>One</td>
                  <td>Never own work</td>
                  <td>Ships one issue as one pull request.</td>
                </tr>
                <tr>
                  <td>Reviewer</td>
                  <td>No</td>
                  <td>Yes</td>
                  <td>Grants or withholds the verdict.</td>
                </tr>
                <tr>
                  <td>Tester</td>
                  <td>Filed gap only</td>
                  <td>No</td>
                  <td>Finds and closes coverage gaps.</td>
                </tr>
                <tr>
                  <td>Fixer</td>
                  <td>No</td>
                  <td>No</td>
                  <td>Addresses review feedback in place.</td>
                </tr>
                <tr>
                  <td>Janitor</td>
                  <td>No</td>
                  <td>No</td>
                  <td>Releases stale claims and reservations.</td>
                </tr>
                <tr>
                  <td>Orchestrator</td>
                  <td>No</td>
                  <td>No</td>
                  <td>Reads state and dispatches the next role.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="docs-section docs-install" id="install">
          <div className="docs-section-title">
            <GitBranch />
            <h2>Install the campaign pack</h2>
          </div>
          <p>
            Rallypoint’s CLI reads its own signed campaign manifest and writes
            each file to an explicit repository-root path. It stops on
            conflicts rather than overwriting anything silently. An existing
            AGENTS.md gets special handling: it’s left untouched, the rest of
            the loop still installs, and the CLI suggests adding a one-line{" "}
            <code>@AGENTIC_LOOP.md</code> reference to it.
          </p>
          <CommandCopy
            command="npx rallypoint@latest view loop"
            id="docs-view"
          />
          <CommandCopy
            command="npx rallypoint@latest add loop"
            id="docs-install"
          />
        </section>

        <section className="docs-section docs-prompting" id="prompting">
          <div className="docs-section-title">
            <MessageSquare />
            <h2>Prompt the party</h2>
          </div>
          <p>
            A role is one file, so at minimum, prompting an agent to become
            that role means pointing a fresh session at{" "}
            <code>AGENTS.md</code> and exactly one file under{" "}
            <code>.rallypoint/roles/</code>. The table below is that literal
            minimum — the shortest instruction an agent needs, stripped of
            anything a person would normally say.
          </p>
          <p>
            Don’t know what should happen next? Prompt the orchestrator
            first. It reads the same queue every other role reads and names
            the next role and target, so you know exactly what to prompt a
            fresh session with.
          </p>
          <div className="docs-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Prompt</th>
                </tr>
              </thead>
              <tbody>
                {rolePrompts.map(({ role, prompt }) => (
                  <tr key={role}>
                    <td>{role}</td>
                    <td>{prompt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CommandCopy
            command="Read AGENTS.md, then read .rallypoint/roles/orchestrator.md. Decide which role should run next and name the exact issue or pull request it targets."
            id="docs-prompt-orchestrator"
          />

          <h3 className="docs-subheading">How a person actually asks</h3>
          <p>
            Nobody talks like the table above. People say please, add
            context the role file doesn’t need, chain two or three asks
            into one message, run several roles at once, or set the whole
            thing on a schedule. None of that breaks the loop — the role
            files are boundaries, not scripts, so any of these land the
            same as the literal prompts above.
          </p>
          <ul className="prompt-examples">
            {humanPrompts.map(({ label, prompt }) => (
              <li className="prompt-example" key={label}>
                <p className="prompt-label">{label}</p>
                <p className="prompt-text">“{prompt}”</p>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </main>
  );
}
