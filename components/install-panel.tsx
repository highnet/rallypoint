"use client";

import { CommandCopy } from "@/components/command-copy";
import { type InstallMode, useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const modes: Array<{
  id: InstallMode;
  label: string;
  command: string;
  detail: string;
}> = [
  {
    id: "npm",
    label: "npm",
    command: "npx rallypoint@latest add loop",
    detail: "Writes the loop with Rallypoint’s own conflict-safe CLI. Add the dry-run flag to plan without writing.",
  },
  {
    id: "pnpm",
    label: "pnpm",
    command: "pnpm dlx rallypoint@latest add loop",
    detail: "Runs the same first-party registry installer through pnpm.",
  },
  {
    id: "inspect",
    label: "Inspect first",
    command: "npx rallypoint@latest view loop",
    detail: "Prints every target path and checksum without writing to your repository.",
  },
];

// A representative install, not the whole manifest — `view loop` prints every
// target and checksum.
const files = [
  "AGENTS.md",
  "AGENTIC_LOOP.md",
  "docs/AGENT_LOOP.md",
  ".rallypoint/LICENSE",
  ".rallypoint/config.json",
  ".rallypoint/roles/orchestrator.md",
  ".rallypoint/roles/planner.md",
  ".rallypoint/roles/worker.md",
  ".rallypoint/roles/reviewer.md",
  ".rallypoint/roles/tester.md",
  ".rallypoint/roles/fixer.md",
  ".rallypoint/roles/janitor.md",
  ".rallypoint/roles/merger.md",
  ".rallypoint/scripts/claim.mjs",
  ".rallypoint/scripts/review.mjs",
  ".rallypoint/scripts/report.mjs",
  ".rallypoint/scripts/janitor-pass.mjs",
];

export function InstallPanel() {
  const installMode = useRallypointStore((state) => state.installMode);
  const setInstallMode = useRallypointStore((state) => state.setInstallMode);
  const selected = modes.find((mode) => mode.id === installMode) ?? modes[0];

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = modes.findIndex((mode) => mode.id === installMode);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = modes[(index + delta + modes.length) % modes.length];
    setInstallMode(next.id);
    document.getElementById(`install-tab-${next.id}`)?.focus();
  };

  return (
    <div className="install">
      <div className="install-steps">
        <div className="install-step">
          <p className="step-title">
            <span className="step-index">1</span> Write the loop into your repository
          </p>
          <div aria-label="Install method" className="tabs" onKeyDown={onKeyDown} role="tablist">
            {modes.map((mode) => (
              <button
                aria-controls="install-panel"
                aria-selected={installMode === mode.id}
                className={cn("tab", installMode === mode.id && "is-selected")}
                id={`install-tab-${mode.id}`}
                key={mode.id}
                onClick={() => setInstallMode(mode.id)}
                role="tab"
                tabIndex={installMode === mode.id ? 0 : -1}
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div aria-labelledby={`install-tab-${selected.id}`} id="install-panel" role="tabpanel">
            <CommandCopy command={selected.command} id={`install-${selected.id}`} label="install command" />
            <p className="install-detail">{selected.detail}</p>
          </div>
        </div>
        <div className="install-step">
          <p className="step-title">
            <span className="step-index">2</span> Bring GitHub up to date
          </p>
          <CommandCopy command="npx rallypoint@latest init" id="install-init" label="init command" />
          <p className="install-detail">
            Needs an authenticated <code>gh</code>. Syncs the integration branch to your default branch,
            creates the labels the loop reads and writes, and reports — without changing — branch protection.
          </p>
        </div>
      </div>
      <div className="manifest">
        <p className="manifest-title">What lands in the repository</p>
        <ul aria-label="Files installed by Rallypoint">
          {files.map((file) => (
            <li key={file}>
              <code>{file}</code>
            </li>
          ))}
        </ul>
        <p className="manifest-more">…and the rest of the scripts. <code>view loop</code> lists every file with its checksum.</p>
      </div>
    </div>
  );
}
