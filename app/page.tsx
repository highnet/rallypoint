import {
  ArrowDown,
  ArrowRight,
  GitBranch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { CommandCopy } from "@/components/command-copy";
import { AudienceFork } from "@/components/audience-fork";
import { CampaignBackground } from "@/components/campaign-background";
import { InstallPanel } from "@/components/install-panel";
import { MobileNav } from "@/components/mobile-nav";
import { OwnershipBand } from "@/components/ownership-band";
import { RoleParty } from "@/components/role-party";
import { TabletopLoop } from "@/components/tabletop-loop";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const heroCommand = "npx rallypoint@latest add loop";

export default function Home() {
  return (
    <main>
      <section className="hero" id="top">
        <CampaignBackground />
        <header className="site-header">
          <Wordmark href="#top" />
          <nav aria-label="Primary navigation">
            <Link href="#loop">The loop</Link>
            <Link href="#party">Roles</Link>
            <Link href="#install">Install</Link>
            <Link href="/docs">Playbook</Link>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <MobileNav />
          </div>
        </header>

        <AudienceFork
          human={
            <div className="hero-grid">
              <div className="hero-copy">
            <div className="campaign-stamp">
              <Sparkles aria-hidden="true" />
              GitHub-native agent orchestration
            </div>
            <h1>Your agents need a quest log.</h1>
            <p className="hero-lede">
              Rallypoint installs a disciplined loop of planners, workers,
              reviewers, testers, and fixers into the repository you already
              have.
            </p>
            <div className="hero-actions">
              <a
                className={cn(buttonVariants({ variant: "quest", size: "lg" }))}
                href="#install"
              >
                Install Rallypoint
                <ArrowRight />
              </a>
              <a
                className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
                href="#loop"
              >
                View the campaign
                <ArrowDown />
              </a>
            </div>
            <CommandCopy command={heroCommand} id="hero-command" />
              </div>
              <TabletopLoop />
            </div>
          }
        />
      </section>

      <section className="manifesto" id="loop">
        <div className="section-heading">
          <p className="section-note">One shared campaign board</p>
          <h2>Read state. Claim one quest. Earn the merge.</h2>
        </div>
        <div className="manifesto-copy">
          <p>
            Rallypoint keeps coordination where the work already lives:
            GitHub issues are the quest log, branches are active expeditions,
            and pull requests are the gates every change must pass.
          </p>
          <div className="oath">
            <ShieldCheck aria-hidden="true" />
            <p>
              No side-channel database. No agent reviews its own work. No
              worker carries more than one claimed issue.
            </p>
          </div>
        </div>
        <div className="loop-ribbon" aria-label="Rallypoint workflow">
          {["Read state", "Claim", "Build", "Review", "Merge"].map(
            (stage, index) => (
              <div key={stage}>
                <span>{index + 1}</span>
                <strong>{stage}</strong>
                {index < 4 && <ArrowRight aria-hidden="true" />}
              </div>
            ),
          )}
        </div>
      </section>

      <section className="party-section" id="party">
        <div className="section-heading party-heading">
          <p className="section-note">Assemble the party</p>
          <h2>Separate roles. Explicit powers. Fewer collisions.</h2>
        </div>
        <RoleParty />
      </section>

      <section className="install-section" id="install">
        <div className="section-heading install-heading">
          <p className="section-note">Drop it into an existing repo</p>
          <h2>One command installs the whole campaign.</h2>
          <span>
            Powered by Rallypoint’s own registry and zero-dependency CLI:
            source-owned, inspectable, conflict-safe, and easy to remove.
          </span>
        </div>
        <InstallPanel />
      </section>

      <section className="ownership-section" id="ownership">
        <div className="section-heading">
          <p className="section-note">No lock-in, no subscription</p>
          <h2>You own what gets installed.</h2>
        </div>
        <OwnershipBand />
      </section>

      <section className="proof-section">
        <div className="proof-mark" aria-hidden="true">
          <GitBranch />
        </div>
        <div>
          <p>Proven in the wild</p>
          <h2>Extracted from the loop that builds Codewright.</h2>
        </div>
        <p>
          Atomic issue claims, strict role boundaries, one-issue branches,
          independent review, fixer passes, and stale-state cleanup—distilled
          into a portable repository protocol.
        </p>
        <Link
          className={cn(buttonVariants({ variant: "parchment", size: "lg" }))}
          href="/docs"
        >
          Read the playbook
          <ArrowRight />
        </Link>
      </section>

      <footer>
        <Wordmark className="footer-wordmark" href="#top" />
        <p>GitHub is the board. Agents are the party.</p>
      </footer>
    </main>
  );
}
