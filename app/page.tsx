/**
 * THESIS: Rallypoint is a living hexcrawl atlas; it refuses the standard
 * developer-tool hero with a decorative dashboard beside it.
 * OWN-WORLD: candlelit carved oak, aged vellum, charcoal engraving, moss,
 * oxblood, lapis, tarnished brass, ember routes, and authored creature plates.
 * STORY: see the repository as a world, choose a role location, understand the
 * handoff, then install the protocol into the repo.
 * FIRST VIEWPORT: a pinned expedition folio occupies the left third while a
 * dominant selectable atlas and its six inhabited locations fill the rest.
 * FORM: approved Hexcrawl Atlas direction C, ranked first for immersion; the
 * staging is an atlas pinned open on a ranger's campaign table.
 */
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
import { InstallPanel } from "@/components/install-panel";
import { LoopRibbon } from "@/components/loop-ribbon";
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
        <header className="site-header">
          <Wordmark href="#top" />
          <nav aria-label="Primary navigation">
            <Link href="#loop">The loop</Link>
            <Link href="#party">Roles</Link>
            <Link href="#install">Install</Link>
            <Link href="/docs">Docs</Link>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <MobileNav />
          </div>
        </header>

        <AudienceFork
          human={
            <div className="hero-grid">
              <div className="hero-copy expedition-folio">
                <span className="folio-thread" aria-hidden="true" />
                <div className="campaign-stamp">
                  <Sparkles aria-hidden="true" />
                  Field codex · GitHub-native orchestration
                </div>
                <h1>Your agents need a quest log.</h1>
                <p className="hero-lede">
                  Rallypoint turns your repository into a living campaign:
                  explicit roles, one quest at a time, independent review, and
                  a trail every agent can follow.
                </p>
                <div className="hero-actions">
                  <a
                    className={cn(buttonVariants({ variant: "quest", size: "lg" }))}
                    href="#install"
                  >
                    Install the loop
                    <ArrowRight />
                  </a>
                  <a
                    className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
                    href="#loop"
                  >
                    Read the field rules
                    <ArrowDown />
                  </a>
                </div>
                <CommandCopy command={heroCommand} id="hero-command" />
                <p className="folio-footnote">
                  Additive. Conflict-safe. The repository remains the source of truth.
                </p>
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
        <div
          aria-label="The six role handoff shown as an ember trail across the campaign"
          className="protocol-art"
          role="img"
        />
        <p className="loop-ribbon-hint">
          Tap a step to see what it does and open the role that owns it.
        </p>
        <LoopRibbon />
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
        <div
          aria-label="A fox archivist opening a repository charter vault filled with role folios, keys, and removable seals"
          className="ownership-art"
          role="img"
        />
        <div className="ownership-folio">
          <div className="section-heading">
            <p className="section-note">No lock-in, no subscription</p>
            <h2>You own what gets installed.</h2>
          </div>
          <OwnershipBand />
        </div>
      </section>

      <section className="proof-section">
        <div
          aria-label="The Codewright forge-bastion where a raven smith, badger mason, and owl verifier complete an ember-lit bridge"
          className="proof-art"
          role="img"
        />
        <div className="proof-folio">
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
            className={cn(
              buttonVariants({ variant: "parchment", size: "lg" }),
              "proof-cta",
            )}
            href="/docs"
          >
            Read the docs
            <ArrowRight />
          </Link>
        </div>
      </section>

      <footer>
        <Wordmark className="footer-wordmark" href="#top" />
        <p>GitHub is the board. Agents are the party.</p>
      </footer>
    </main>
  );
}
