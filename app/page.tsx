import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AudienceFork, AudienceSwitch } from "@/components/audience-fork";
import { ClaimRace } from "@/components/claim-race";
import { CommandCopy } from "@/components/command-copy";
import { ImprovementCycle } from "@/components/improvement-cycle";
import { InstallPanel } from "@/components/install-panel";
import { OwnershipBand } from "@/components/ownership-band";
import { PrTally } from "@/components/pr-tally";
import { RoleMatrix } from "@/components/role-matrix";
import { SignalRail } from "@/components/signal-rail";
import { SiteHeader } from "@/components/site-header";
import { LabelTable, StateLines } from "@/components/state-lines";
import { SiteFooter } from "@/components/site-footer";

const heroCommand = "npx rallypoint@latest add loop";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section aria-label="Introduction" className="hero">
          <div className="hero-bar">
            <AudienceSwitch />
          </div>
          <AudienceFork
            human={
              <>
                <div className="hero-grid">
                  <h1 className="hero-title">
                    Coordinate coding agents with nothing but&nbsp;GitHub.
                  </h1>
                  <div className="hero-side">
                    <p className="lede">
                      Rallypoint installs a self-improving graph of agents into your repository: nine
                      roles, a label state machine and an atomic claim. Agents never message each
                      other: they read and write issues, branches, labels and pull requests — no
                      agent approves its own work, and the loop tunes its own prompts on measured
                      results.
                    </p>
                    <CommandCopy command={heroCommand} id="hero-command" label="install command" />
                    <p className="hero-links">
                      <Link className="text-link" href="/docs">
                        Read the docs <ArrowRight aria-hidden="true" />
                      </Link>
                      <span>MIT · agent-agnostic</span>
                    </p>
                  </div>
                </div>
                <SignalRail />
              </>
            }
          />
        </section>

        <section aria-labelledby="claim-title" className="band band-yellow" id="claim">
          <div className="band-inner claim-layout">
            <div className="claim-copy">
              <h2 id="claim-title">One claim per issue, decided by GitHub.</h2>
              <p>
                Assignment is not a lock. Before a worker touches an issue, <code>claim.mjs</code>{" "}
                creates a reservation ref. GitHub creates a ref exactly once — so when two sessions
                reach for the same issue, one gets it and the other moves on.
              </p>
            </div>
            <ClaimRace />
          </div>
        </section>

        <section aria-labelledby="labels-title" className="band" id="labels">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="labels-title">Labels are the state machine.</h2>
              <p>
                There is no side-channel database. An issue’s labels say whether it can be claimed,
                who holds it, and what it is waiting on; a pull request’s labels carry the verdict.
                Every agent reads the same board.
              </p>
            </div>
            <StateLines />
            <LabelTable />
          </div>
        </section>

        <section aria-labelledby="roles-title" className="band band-rule" id="roles">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="roles-title">Nine roles. None approves its own work.</h2>
              <p>
                Every session adopts exactly one role and works inside its boundary. Each role is one
                plain file under <code>.rallypoint/roles/</code>, so prompting an agent into it is one
                sentence.
              </p>
            </div>
            <RoleMatrix />
          </div>
        </section>

        <section aria-labelledby="improve-title" className="band band-rule" id="improve">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="improve-title">A graph that improves itself, and cannot grade itself.</h2>
              <p>
                Roles are the nodes, labels are the edges, and GitHub holds the state. The improver
                closes the last loop: it measures how delivery went, changes one role prompt, and
                keeps the change only if the numbers say so. Scripts, config and the reviewer’s and
                merger’s prompts are frozen to it — an optimiser that can edit its own judge improves
                the score, not the work.
              </p>
            </div>
            <ImprovementCycle />
          </div>
        </section>

        <section aria-labelledby="proof-title" className="band band-blue" id="proof">
          <div className="band-inner proof-layout">
            <div className="proof-copy">
              <h2 id="proof-title">UTON OS was built through this loop.</h2>
              <p>
                A studio booking platform with payments, delivered by agents in Claude Code, Codex and
                OpenCode with GitHub as the only source of truth: 1,328 pull requests opened and 1,256
                merged in eight weeks. Payments, credentials and auth stayed on human-only approval
                paths.
              </p>
            </div>
            <PrTally />
          </div>
        </section>

        <section aria-labelledby="install-title" className="band" id="install">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="install-title">Two commands. Then it is your code.</h2>
              <p>
                Rallypoint’s zero-dependency CLI reads its own checksummed manifest, refuses
                conflicting writes, and leaves an existing <code>AGENTS.md</code> untouched.
              </p>
            </div>
            <InstallPanel />
            <OwnershipBand />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
