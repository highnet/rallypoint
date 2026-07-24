import {
  ArrowLeft,
  CircleDot,
  GitBranch,
  GitFork,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { CommandCopy } from "@/components/command-copy";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        </nav>
        <div className="header-actions">
          <a
            aria-label="Rallypoint repository on GitHub"
            className="github-link"
            href="https://github.com/highnet/highnet-agentic-loop"
          >
              <GitFork aria-hidden="true" />
          </a>
          <ThemeToggle />
          <MobileNav />
        </div>
      </header>

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
                  <td>Never</td>
                  <td>Never</td>
                  <td>Surveys the queue and recommends role session counts, on demand.</td>
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
          <a
            className={cn(buttonVariants({ variant: "quest", size: "lg" }))}
            href="https://github.com/highnet/highnet-agentic-loop"
          >
            Open the repository
            <GitFork />
          </a>
        </section>
      </article>
    </main>
  );
}
