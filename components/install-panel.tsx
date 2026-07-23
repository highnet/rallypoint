"use client";

import { Check, FileCode2, GitFork, PackagePlus } from "lucide-react";

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
    id: "shadcn",
    label: "Registry",
    icon: PackagePlus,
    command: "npx shadcn@latest add https://rallypoint.dev/r/loop.json",
    detail: "Adds every protocol file at its intended repository path.",
  },
  {
    id: "github",
    label: "GitHub",
    icon: GitFork,
    command: "npx shadcn@latest add highnet/highnet-agentic-loop/loop",
    detail: "Install directly from the GitHub registry once the repository is public.",
  },
  {
    id: "manual",
    label: "Inspect first",
    icon: FileCode2,
    command: "npx shadcn@latest view highnet/highnet-agentic-loop/loop",
    detail: "Review the complete payload before writing anything.",
  },
];

const files = [
  "AGENTS.md",
  "docs/AGENT_LOOP.md",
  ".rallypoint/config.json",
  ".rallypoint/roles/planner.md",
  ".rallypoint/roles/worker.md",
  ".rallypoint/roles/reviewer.md",
  ".rallypoint/roles/tester.md",
  ".rallypoint/roles/fixer.md",
  ".rallypoint/roles/janitor.md",
];

export function InstallPanel() {
  const installMode = useRallypointStore((state) => state.installMode);
  const setInstallMode = useRallypointStore((state) => state.setInstallMode);
  const selected = modes.find((mode) => mode.id === installMode) ?? modes[0];

  return (
    <div className="install-grid">
      <div className="install-console">
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
          <span><Check /> Additive</span>
          <span><Check /> Reviewable</span>
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
