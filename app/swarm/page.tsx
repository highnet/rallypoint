import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AudienceFork, AudienceSwitch } from "@/components/audience-fork";
import { CommandCopy } from "@/components/command-copy";
import { LabelChip } from "@/components/label-chip";
import { SignalFlag } from "@/components/signal-flag";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SwarmCompare } from "@/components/swarm-compare";
import { SwarmAgentQuickstart } from "@/components/swarm-agent-quickstart";
import { SwarmMark } from "@/components/swarm-mark";
import { SwarmMechanism } from "@/components/swarm-mechanism";
import { SwarmScreens } from "@/components/swarm-screens";
import {
  arenaPitch,
  arenaUrl,
  conductorPrompt,
  emptyWizard,
  genesisPrompt,
  measureModes,
  swarmCommands,
  swarmDispatcher,
  swarmEnvLines,
  swarmLoop,
  swarmPrompts,
  swarmRoles,
  swarmUiEnvLines,
  swarmUiRoutes,
} from "@/lib/swarm";

const title = "Rallypoint Swarm";
const description =
  "The next tier of Rallypoint: shared memory in your own Supabase, a referee on every change, roles that pick themselves finishing first, a retro from every session, and a conductor loop — for goals no single agent finishes alone.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/swarm" },
  openGraph: {
    title: `${title} · Rallypoint`,
    description,
    url: "/swarm",
    siteName: "Rallypoint",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} · Rallypoint`,
    description,
  },
};

const toc = [
  { href: "#looks", label: "What it looks like" },
  { href: "#adds", label: "What it adds" },
  { href: "#learning", label: "Learning" },
  { href: "#roles", label: "Roles" },
  { href: "#referee", label: "Referee" },
  { href: "#conductor", label: "Conductor" },
  { href: "#prompts", label: "Prompts" },
  { href: "#ui", label: "Swarm UI" },
  { href: "#requirements", label: "Requirements" },
  { href: "#setup", label: "Setup" },
];

const memoryRows = [
  {
    record: "Retros",
    written: "swarm retro --well … --friction … --suggest …",
    when: "At the end of every session, whatever its role.",
    used: "After three retros since the last protocol change, the improver proposes one change to a tunable skill or role prompt.",
  },
  {
    record: "Buried ideas",
    written: "swarm bury --idea … --reason … --lesson …",
    when: "When a change loses at the referee.",
    used: "Kept with the numbers that killed it, so the next session does not retry a dead end blindly.",
  },
  {
    record: "Concepts",
    written: "swarm concept trial <id> --outcome …",
    when: "When an idea is tried on a target: gained, lost or neutral.",
    used: "The strategist ports what gained on one target to the others.",
  },
  {
    record: "Results and versions",
    written: "swarm referee · swarm ship",
    when: "Every referee run; every merged version.",
    used: "Ship rate, median claim-to-close time and progress per session, from the swarm_metrics view.",
  },
  {
    record: "Messages",
    written: "swarm say --kind question|proposal|handoff …",
    when: "When a session needs to ask, propose or hand off.",
    used: "Read by the next session with swarm inbox, and by anyone on the Board.",
  },
];

const requirements = [
  {
    need: "A GitHub repository",
    detail: (
      <>
        With <code>gh</code> installed and authenticated. GitHub still owns every issue, claim and pull
        request.
      </>
    ),
  },
  { need: "Node.js 20 or newer", detail: <>The swarm CLI has no dependencies beyond Node.</> },
  {
    need: "Rallypoint installed",
    detail: (
      <>
        <code>{swarmCommands.addLoop}</code>, then <code>{swarmCommands.init}</code>. Branch protection on
        the default branch is recommended; <code>init</code> reports it.
      </>
    ),
  },
  {
    need: "A coding agent with a shell and gh",
    detail: (
      <>
        Claude Code, Codex, Cursor or any other. For the unattended conductor: Claude Code with remote
        session tools, or Codex with Codex Cloud, so each role runs in its own session.
      </>
    ),
  },
  {
    need: "A budget",
    detail: <>Every session spends model usage. The conductor can stop after a set number of sessions.</>,
  },
  {
    need: "Your own Supabase project",
    detail: (
      <>
        With <code>.rallypoint/swarm/schema.sql</code> applied, and <code>RALLYPOINT_SUPABASE_URL</code>{" "}
        and <code>RALLYPOINT_SUPABASE_KEY</code> (the publishable key) set.
      </>
    ),
  },
  {
    need: "A swarm secret",
    detail: (
      <>
        <code>RALLYPOINT_SWARM_SECRET</code>, for agents only: never committed, never in the browser.{" "}
        <code>{swarmCommands.connect}</code> prompts for it (or generates one) and stores only its hash in
        the database
      </>
    ),
  },
  {
    need: "A goal, and optionally a way to measure it",
    detail: <>A score command, pass/fail checks, or independent review alone. The wizard helps you write both.</>,
  },
  { need: "Optionally, a host for the UI", detail: <>Vercel or any host that runs a Next.js app.</> },
  {
    need: "A human operator",
    detail: (
      <>
        Someone who answers <LabelChip label="human" />. The swarm escalates to you and never works
        around it.
      </>
    ),
  },
];

export default function SwarmPage() {
  const conductorExample = conductorPrompt(emptyWizard);

  return (
    <>
      <SiteHeader current="/swarm" />
      <main id="main">
        <div className="swarm-audience-bar">
          <AudienceSwitch />
        </div>
        <AudienceFork
          agent={<SwarmAgentQuickstart />}
          human={
            <>
        <div className="swarm-intro">
          <div className="swarm-intro-grid">
            <div className="swarm-intro-title swarm-mark-trigger">
              <SwarmMark className="swarm-hero-mark" />
              <h1>Rallypoint Swarm. For goals no single agent finishes alone.</h1>
            </div>
            <div className="swarm-intro-side">
              <p className="lede">
                The next tier of Rallypoint. Swarm keeps GitHub as the owner of the work and adds what a
                hard goal needs: shared memory in your own Supabase, a referee on every change, roles that
                pick themselves, and a retro from every session, so the swarm learns across attempts.
              </p>
              <CommandCopy command={swarmCommands.addSwarm} id="swarm-hero-add" label="Swarm install command" />
              <p className="hero-links">
                <Link className="btn btn-primary" href="/swarm/wizard">
                  Describe your swarm <ArrowRight aria-hidden="true" />
                </Link>
                <span>Builds on the loop · more setup, more capability</span>
              </p>
            </div>
          </div>
          <nav aria-label="On this page" className="swarm-toc">
            <ol>
              {toc.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        <section aria-labelledby="looks-title" className="band" id="looks">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="looks-title">What a swarm looks like.</h2>
              <p>
                Swarm Arena is a real swarm: one pitch, four engines, agents dispatched around the clock.
                These pages grew from the same UI scaffold <code>add swarm-ui</code> installs, then the
                swarm made them its own.
              </p>
            </div>
            <SwarmScreens />
          </div>
        </section>

        <section aria-labelledby="adds-title" className="band" id="adds">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="adds-title">The same loop, plus a memory.</h2>
              <p>
                The loop coordinates agents well on a known backlog. A hard goal has no backlog and no
                finish line, and sessions never share a context window. The missing piece is shared
                memory, and that is what Swarm adds.
              </p>
            </div>
            <SwarmCompare />
            <SwarmMechanism />
          </div>
        </section>

        <section aria-labelledby="loop-title" className="band band-rule" id="loop">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="loop-title">One issue through the swarm, agent by agent.</h2>
              <p>
                All seven stations of the vanilla loop, Filed to Merged, in the same order and held by
                the same agents. Swarm adds a referee before the pull request, a burial when an idea
                loses, and a retro that feeds the improver.
              </p>
            </div>
            <ol className="swarm-roles swarm-loop">
              {swarmLoop.map((step, index) => (
                <li key={step.name}>
                  <span className="swarm-role-index">{index + 1}</span>
                  <span className="role-cell swarm-role-name">
                    {step.holder === "every" ? null : (
                      <SignalFlag className="role-flag" signal={step.holder} />
                    )}
                    <span>
                      <strong>{step.name}</strong>
                      <br />
                      {step.holder === "every" ? (
                        step.holderName
                      ) : (
                        <Link href={`/agents/${step.holder}`}>{step.holderName}</Link>
                      )}
                      {step.swarm ? <span className="swarm-loop-added"> · Swarm</span> : null}
                    </span>
                  </span>
                  <p className="swarm-role-job">{step.does}</p>
                  <code className="swarm-role-command">{step.command}</code>
                </li>
              ))}
            </ol>
            <p className="swarm-note">
              Also on duty: the janitor clears stale claims, and the tester is there for any
              verification on top of the referee.
            </p>
          </div>
        </section>

        <section aria-labelledby="learning-title" className="band" id="learning">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="learning-title">It learns across attempts.</h2>
              <p>
                Every session leaves a retro, every failed idea is buried with its numbers, and every
                concept that worked is ported to the next target. The improver turns all of that into
                changes to the protocol itself.
              </p>
            </div>
            <div className="table-wrap">
              <table className="code-table memory-table">
                <caption className="sr-only">What the swarm remembers, who writes it, and what reads it</caption>
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">Written with</th>
                    <th scope="col">When</th>
                    <th scope="col">What it changes</th>
                  </tr>
                </thead>
                <tbody>
                  {memoryRows.map((row) => (
                    <tr key={row.record}>
                      <th scope="row">{row.record}</th>
                      <td data-label="Written with">
                        <code>{row.written}</code>
                      </td>
                      <td data-label="When">{row.when}</td>
                      <td data-label="What it changes">{row.used}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="roles-title" className="band" id="roles">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="roles-title">Sessions pick their own role, finishing first.</h2>
              <p>
                Nobody pastes a role prompt. A new session runs <code>swarm next</code>, which walks this
                order top to bottom and takes the first role with work waiting, so open pull requests land
                before new work starts. It prints <code>ROLE</code>, <code>TARGET</code> and the role file
                to <code>READ</code>.
              </p>
            </div>
            <div className="swarm-dispatcher">
              <span className="role-cell swarm-role-name">
                <SignalFlag className="role-flag" signal={swarmDispatcher.slug} />
                <Link href={`/agents/${swarmDispatcher.slug}`}>{swarmDispatcher.name}</Link>
              </span>
              <p className="swarm-role-job">{swarmDispatcher.job}</p>
              <code className="swarm-role-command">{swarmDispatcher.command}</code>
              <p className="swarm-dispatcher-note">dispatches a fleet, one session per role ↓</p>
            </div>
            <ol className="swarm-roles">
              {swarmRoles.map((role, index) => (
                <li key={role.slug}>
                  <span className="swarm-role-index">{index + 1}</span>
                  <span className="role-cell swarm-role-name">
                    <SignalFlag className="role-flag" signal={role.slug} />
                    <Link href={`/agents/${role.slug}`}>{role.name}</Link>
                  </span>
                  <p className="swarm-role-job">{role.job}</p>
                  {role.command ? (
                    <code className="swarm-role-command">{role.command}</code>
                  ) : (
                    <span aria-hidden="true" className="swarm-role-command" />
                  )}
                </li>
              ))}
            </ol>
            <p className="swarm-note">
              The planner runs as the strategist: it reads <code>swarm brief</code> (goal, targets,
              versions, buried ideas, concept trials, open work) and opens issues with{" "}
              <code>swarm plan</code>. The orchestrator runs as the conductor: it starts the fleet,
              and each session it starts takes its role with <code>swarm next</code>.
            </p>
          </div>
        </section>

        <section aria-labelledby="referee-title" className="band band-yellow" id="referee">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="referee-title">A referee on every change.</h2>
              <p>
                A score that must beat the integration branch, checks that must pass, or independent review
                alone when there is nothing to measure. You choose the mode and supply the commands; the
                referee, review and merge stay frozen.
              </p>
            </div>
            <div className="referee-layout">
              <dl className="referee-modes">
                {measureModes.map((mode) => (
                  <div key={mode.id}>
                    <dt>
                      <code>{mode.id}</code>
                    </dt>
                    <dd>
                      <p>{mode.gate}</p>
                      <p className="referee-fits">{mode.fits}</p>
                    </dd>
                  </div>
                ))}
              </dl>
              <ol className="referee-flow" aria-label="What swarm referee does in score mode">
                <li>
                  <p className="referee-step">Measure both sides</p>
                  <p>
                    <code>swarm referee</code> runs your command on <code>HEAD</code> and on a git worktree
                    of the integration branch. The last stdout line is the score, or{" "}
                    <code>{'{"score": n}'}</code>.
                  </p>
                </li>
                <li>
                  <p className="referee-step">Compare</p>
                  <p>By direction (higher or lower is better) and by your margin. The run is recorded either way.</p>
                </li>
                <li className="referee-win">
                  <p className="referee-step">Wins: exit 0</p>
                  <p>The pull request goes to independent review, then the merger ships the version with its score.</p>
                </li>
                <li className="referee-lose">
                  <p className="referee-step">Loses: exit 3</p>
                  <p>
                    It does not merge. <code>swarm bury</code> records the idea, the reason, the lesson and
                    the numbers.
                  </p>
                </li>
              </ol>
            </div>
            <p className="referee-delivery">
              Progress without a score is shown as delivery: merged against open issues, per target.
            </p>
          </div>
        </section>

        <section aria-labelledby="conductor-title" className="band" id="conductor">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="conductor-title">One conductor keeps it running.</h2>
              <p>
                The conductor runs in Claude Code, as a <code>/loop</code> with remote sessions, or in
                Codex, with each role a Codex Cloud task started by <code>swarm dispatch</code>. Each pass
                it reads <code>swarm status</code> and starts one separate session per role and target.
                Subagents stay inside a role; nothing approves its own work.
              </p>
            </div>
            <div className="conductor-layout">
              <dl className="conductor-spec">
                <div>
                  <dt>Concurrency</dt>
                  <dd>How many sessions run at once: 1, 2, 3, 4, 6 or 8.</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>Unbounded, or stop after 6, 12 or 24 sessions and report.</dd>
                </div>
                <div>
                  <dt>Focus</dt>
                  <dd>
                    <code>balanced</code>, <code>finish-first</code>, <code>experiments</code> or{" "}
                    <code>port-concepts</code>.
                  </dd>
                </div>
                <div>
                  <dt>Escalation</dt>
                  <dd>
                    Anything labelled <LabelChip label="human" /> comes to you. The conductor never works
                    around it.
                  </dd>
                </div>
              </dl>
              <div className="conductor-prompt">
                <p className="step-title">Conductor prompt</p>
                <CommandCopy
                  className="command-block"
                  command={conductorExample}
                  id="swarm-conductor"
                  label="conductor prompt"
                  shell={false}
                />
                <p className="install-detail">
                  Or run one session by hand: <code>{swarmCommands.agentPrompt}</code>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="prompts-title" className="band band-rule" id="prompts">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="prompts-title">A prompt for every situation.</h2>
              <p>
                Paste one into a coding agent on the repository after genesis has merged. Each is
                self-contained; the session picks up the rest from the skills.
              </p>
            </div>
            <ul className="swarm-prompts">
              {swarmPrompts().map((item) => (
                <li key={item.id}>
                  <p className="step-title">{item.title}</p>
                  <p className="install-detail">{item.when}</p>
                  <CommandCopy command={item.prompt} id={`swarm-prompt-${item.id}`} label={`${item.title.toLowerCase()} prompt`} shell={false} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="ui-title" className="band" id="ui">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="ui-title">The swarm UI starts as a scaffold. Then it is yours.</h2>
              <p>
                Rallypoint ships the routes, wired read-only to your memory and GitHub, plus a
                project-owned <code>app/swarm/swarm.config.ts</code> generated from your{" "}
                <code>.rallypoint/swarm.json</code>. Rallypoint never overwrites that file.
              </p>
            </div>
            <div className="ui-layout">
              <div className="ui-shapes">
                <div className="ui-shape">
                  <p className="step-title">The UI is the product</p>
                  <CommandCopy command={swarmCommands.addUi} id="swarm-add-ui" label="swarm-ui install command" />
                  <p className="install-detail">
                    Writes <code>app/swarm/**</code> into an existing Next.js App Router app, the way Swarm
                    Arena’s public record is the site itself.
                  </p>
                </div>
                <div className="ui-shape">
                  <p className="step-title">A standalone dashboard</p>
                  <CommandCopy
                    command={swarmCommands.addDashboard}
                    id="swarm-add-dashboard"
                    label="swarm-dashboard install command"
                  />
                  <p className="install-detail">
                    Scaffolds a small Next.js app in <code>swarm-ui/</code>, for a Rust, Python or proof
                    repository, or when the dashboard should stay separate. Deployable to Vercel.
                  </p>
                </div>
                <div className="ui-shape">
                  <p className="step-title">What the UI reads</p>
                  <CommandCopy
                    className="command-block"
                    command={swarmUiEnvLines}
                    id="swarm-ui-env"
                    label="UI environment"
                    shell={false}
                  />
                  <p className="install-detail">
                    Public and read-only by default (the publishable key plus read-only row-level security),
                    or private behind Supabase Auth. Only agents write, through the CLI. The browser never
                    writes.
                  </p>
                </div>
              </div>
              <div className="manifest">
                <p className="manifest-title">Scaffold routes</p>
                {swarmUiRoutes.map((group) => (
                  <div className="ui-route-group" key={group.section}>
                    <p className="ui-route-section">{group.section}</p>
                    <ul aria-label={`${group.section} routes`}>
                      {group.routes.map((route) => (
                        <li key={route.path}>
                          <span>{route.name}</span> <code>{route.path}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="manifest-more">
                  <code>swarm.config.ts</code> holds the project name, goal, measure label, unit and
                  direction, targets with colours, vocabulary (“shipped” or “landed”) and theme variables.
                  Your swarm can own the frontend as a <code>ui</code> target and grow it, for example into
                  a live fleet graph like Swarm Arena’s.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="arena-title" className="band band-blue" id="arena">
          <div className="band-inner proof-layout">
            <div className="proof-copy">
              <h2 id="arena-title">Swarm Arena came from one pitch.</h2>
              <div className="arena-proof">
                <blockquote className="arena-pitch">{arenaPitch}</blockquote>
                <p>
                  Chess, Go 9×9, Othello and Hex engines, written from scratch by the swarm. Each version
                  has to beat real opponents (Stockfish, GNU Go, Edax and an MCTS ladder) before it ships.
                  Losing code is thrown out and the lesson is kept. The ratings move while it works, so
                  they live on the arena.
                </p>
                <p className="tier-links">
                  <a className="text-link" href={arenaUrl} rel="noreferrer" target="_blank">
                    Watch the live arena <ArrowUpRight aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <Link className="text-link" href="/swarm/wizard?example=arena">
                    Start from this pitch <ArrowRight aria-hidden="true" />
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>


        <section aria-labelledby="requirements-title" className="band" id="requirements">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="requirements-title">Requirements.</h2>
              <p>More setup than the loop. Everything on this list is yours: no Rallypoint account, ever.</p>
            </div>
            <div className="table-wrap">
              <table className="code-table req-table">
                <caption className="sr-only">What you need to run Rallypoint Swarm</caption>
                <thead>
                  <tr>
                    <th scope="col">You need</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {requirements.map((row) => (
                    <tr key={row.need}>
                      <th scope="row">{row.need}</th>
                      <td data-label="Detail">{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="setup-title" className="band" id="setup">
          <div className="band-inner">
            <div className="section-head">
              <h2 id="setup-title">Setup, in order.</h2>
              <p>
                With the loop already installed. The wizard writes the same sequence with your pitch, your
                measure and your conductor settings filled in.
              </p>
            </div>
            <ol className="setup-steps">
              <li>
                <p className="step-title">Install Swarm on top of the loop</p>
                <CommandCopy command={swarmCommands.addSwarm} id="setup-add" label="Swarm install command" />
                <p className="install-detail">
                  Writes <code>SWARM.md</code>, <code>.rallypoint/swarm.json</code>,{" "}
                  <code>.rallypoint/swarm/**</code> and the <code>.claude/skills/swarm-*</code> skills. Paste
                  the wizard’s <code>swarm.json</code> over the default if you made one.
                </p>
              </li>
              <li>
                <p className="step-title">Optionally, add the UI</p>
                <CommandCopy command={swarmCommands.addUi} id="setup-ui" label="swarm-ui install command" />
                <p className="install-detail">
                  Or <code>{swarmCommands.addDashboard}</code> for a standalone <code>swarm-ui/</code> app.
                </p>
              </li>
              <li>
                <p className="step-title">Apply the schema</p>
                <p className="install-detail">
                  In your Supabase project’s SQL editor, run <code>.rallypoint/swarm/schema.sql</code>.
                </p>
              </li>
              <li>
                <p className="step-title">Connect memory and set the secret</p>
                <CommandCopy command={swarmCommands.connect} id="setup-connect" label="connect command" />
                <p className="install-detail">
                  It asks for the project URL, the publishable key, the service-role key and the swarm secret
                  (hidden; leave it empty to generate one), sets the secret, and writes gitignored env files
                  for agents and the dashboard. Agents elsewhere can use the environment instead:
                </p>
                <CommandCopy
                  className="command-block"
                  command={swarmEnvLines}
                  id="setup-env"
                  label="environment"
                  shell={false}
                />
                <p className="install-detail">
                  Keep <code>RALLYPOINT_SWARM_SECRET</code> out of git and out of the browser.
                </p>
              </li>
              <li>
                <p className="step-title">Check everything</p>
                <CommandCopy command={swarmCommands.doctor} id="setup-doctor" label="doctor command" />
                <p className="install-detail">
                  Checks env, <code>gh</code>, git, the config, Supabase reachability, the schema version and
                  the secret.
                </p>
              </li>
              <li>
                <p className="step-title">Run genesis on your pitch</p>
                <CommandCopy
                  command={genesisPrompt("<your pitch>")}
                  id="setup-genesis"
                  label="genesis prompt"
                  shell={false}
                />
                <p className="install-detail">
                  Paste into a coding agent on the repository. Genesis first interviews you with{" "}
                  <a className="text-link" href="https://interviewme.at" rel="noreferrer" target="_blank">
                    interview-me
                  </a>{" "}
                  until you confirm a brief, then initializes{" "}
                  <a className="text-link" href="https://impeccable.style" rel="noreferrer" target="_blank">
                    Impeccable
                  </a>{" "}
                  so <code>PRODUCT.md</code> and <code>DESIGN.md</code> come from it. From there it decides
                  the targets, the measure and its referee, the completed <code>swarm.json</code>, the UI’s{" "}
                  <code>swarm.config.ts</code> and the first plan of issues, delivered as one pull request.
                  Review and merge it like any other. Swarm Arena’s pitch produced Swarm Arena.
                </p>
              </li>
              <li>
                <p className="step-title">Bring GitHub and memory up to date</p>
                <CommandCopy command={swarmCommands.swarmInit} id="setup-init" label="swarm init command" />
                <p className="install-detail">
                  Creates the <code>target:&lt;name&gt;</code> labels and stores the goal and visibility.
                </p>
              </li>
              <li>
                <p className="step-title">Start the swarm</p>
                <CommandCopy command={swarmCommands.agentPrompt} id="setup-agent" label="agent prompt" shell={false} />
                <p className="install-detail">
                  One session at a time, in any coding agent. Or start the conductor in Claude Code
                  or Codex:
                </p>
                <CommandCopy command={swarmCommands.conductor} id="setup-conductor" label="conductor command" shell={false} />
              </li>
            </ol>
            <p className="swarm-cta">
              <Link className="btn btn-primary btn-lg" href="/swarm/wizard">
                Describe your swarm <ArrowRight aria-hidden="true" />
              </Link>
            </p>
          </div>
        </section>
            </>
          }
        />
      </main>
      <SiteFooter />
    </>
  );
}
