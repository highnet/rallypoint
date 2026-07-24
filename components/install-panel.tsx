"use client";

import { Check, FileCode2, PackagePlus, ScrollText } from "lucide-react";

import { CommandCopy } from "@/components/command-copy";
import { Button } from "@/components/ui/button";
import { type InstallMode, useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const modes: Array<{
  id: InstallMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  command: string;
  detail: string;
}> = [
  {
    id: "npm",
    label: "npm",
    icon: PackagePlus,
    command: "npx rallypoint@latest add loop",
    detail: "Installs the campaign pack with Rallypoint’s own conflict-safe CLI.",
  },
  {
    id: "pnpm",
    label: "pnpm",
    icon: ScrollText,
    command: "pnpm dlx rallypoint@latest add loop",
    detail: "Runs the same first-party registry installer through pnpm.",
  },
  {
    id: "inspect",
    label: "Inspect first",
    icon: FileCode2,
    command: "npx rallypoint@latest view loop",
    detail: "Shows every target and checksum without writing to your repository.",
  },
];

const files = [
  "AGENTS.md",
  "AGENTIC_LOOP.md",
  "docs/AGENT_LOOP.md",
  ".rallypoint/LICENSE",
  ".rallypoint/config.json",
  ".rallypoint/roles/planner.md",
  ".rallypoint/roles/worker.md",
  ".rallypoint/roles/reviewer.md",
  ".rallypoint/roles/tester.md",
  ".rallypoint/roles/fixer.md",
  ".rallypoint/roles/janitor.md",
  ".rallypoint/roles/orchestrator.md",
];

export function InstallPanel() {
  const installMode = useRallypointStore((state) => state.installMode);
  const setInstallMode = useRallypointStore((state) => state.setInstallMode);
  const selected = modes.find((mode) => mode.id === installMode) ?? modes[0];

  return (
    <div className="install-grid">
      <div className="install-console ledger-panel">
        <div className="mode-tabs" role="tablist" aria-label="Install methods">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <Button
                aria-selected={installMode === mode.id}
                className={cn(installMode === mode.id && "is-selected")}
                key={mode.id}
                onClick={() => setInstallMode(mode.id)}
                role="tab"
                size="sm"
                variant="parchment"
              >
                <Icon />
                {mode.label}
              </Button>
            );
          })}
        </div>
        <CommandCopy command={selected.command} id={`install-${selected.id}`} />
        <p>{selected.detail}</p>
        <div className="install-notes">
          <span><Check /> Conflict-safe</span>
          <span><Check /> Dry-run ready</span>
          <span><Check /> Agent-agnostic</span>
        </div>
      </div>

      <div className="file-scroll" aria-label="Files installed by Rallypoint">
        <div className="scroll-roller scroll-roller-top" aria-hidden="true" />
        <p className="scroll-title">The campaign pack</p>
        <ul>
          {files.map((file) => (
            <li key={file}>
              <span aria-hidden="true">◆</span>
              <code>{file}</code>
            </li>
          ))}
        </ul>
        <div className="scroll-roller scroll-roller-bottom" aria-hidden="true" />
      </div>
    </div>
  );
}
