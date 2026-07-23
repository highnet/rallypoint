"use client";

import { BookOpen, CheckCircle2, Flag, GitPullRequest, Hammer } from "lucide-react";

import { useRallypointStore, type LoopStage } from "@/lib/store";
import { cn } from "@/lib/utils";

const stages: Array<{
  id: LoopStage;
  label: string;
  role: string;
  description: string;
  x: number;
  y: number;
  token: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "read",
    label: "Read state",
    role: "Planner",
    description: "Survey the roadmap, issues, pull requests, and repository rules.",
    x: 20,
    y: 29,
    token: "token-round token-parchment",
    icon: BookOpen,
  },
  {
    id: "claim",
    label: "Claim quest",
    role: "Worker",
    description: "Atomically reserve one ready issue before touching code.",
    x: 63,
    y: 15,
    token: "token-triangle token-red",
    icon: Flag,
  },
  {
    id: "build",
    label: "Build",
    role: "Worker",
    description: "Create one branch, complete one issue, and keep the checks green.",
    x: 86,
    y: 48,
    token: "token-square token-blue",
    icon: Hammer,
  },
  {
    id: "review",
    label: "Face review",
    role: "Reviewer",
    description: "A separate agent judges the diff against the quest and the rules.",
    x: 60,
    y: 79,
    token: "token-star token-amber",
    icon: GitPullRequest,
  },
  {
    id: "merge",
    label: "Merge",
    role: "Janitor",
    description: "Green checks and approval close the quest; stale state gets cleaned.",
    x: 21,
    y: 66,
    token: "token-pentagon token-green",
    icon: CheckCircle2,
  },
];

export function TabletopLoop() {
  const activeStage = useRallypointStore((state) => state.activeStage);
  const setActiveStage = useRallypointStore((state) => state.setActiveStage);

  return (
    <div className="campaign-table" aria-label="The five-stage Rallypoint agent loop">
      <div className="felt-noise" aria-hidden="true" />
      <svg
        aria-hidden="true"
        className="route-map"
        preserveAspectRatio="none"
        viewBox="0 0 1000 690"
      >
        <path
          className="route-shadow"
          d="M210 190 C390 75 570 80 700 135 C890 215 925 410 790 535 C650 665 350 640 205 520 C90 425 82 280 210 190 Z"
        />
        <path
          className="route-track"
          d="M210 190 C390 75 570 80 700 135 C890 215 925 410 790 535 C650 665 350 640 205 520 C90 425 82 280 210 190 Z"
        />
        <path
          className="route-line"
          d="M210 190 C390 75 570 80 700 135 C890 215 925 410 790 535 C650 665 350 640 205 520 C90 425 82 280 210 190 Z"
        />
      </svg>

      {stages.map((stage) => {
        const Icon = stage.icon;
        const active = activeStage === stage.id;

        return (
          <button
            aria-pressed={active}
            className={cn("map-stage", active && "is-active")}
            key={stage.id}
            onClick={() => setActiveStage(stage.id)}
            onFocus={() => setActiveStage(stage.id)}
            onMouseEnter={() => setActiveStage(stage.id)}
            style={{ left: `${stage.x}%`, top: `${stage.y}%` }}
            type="button"
          >
            <span className={cn("role-token", stage.token)} aria-hidden="true" />
            <span className="stage-copy">
              <span className="stage-heading">
                <Icon className="stage-icon" />
                {stage.label}
              </span>
              <span className="stage-role">{stage.role}</span>
            </span>
          </button>
        );
      })}

      <div className="map-legend" aria-live="polite">
        <span className="legend-title">
          {stages.find((stage) => stage.id === activeStage)?.label}
        </span>
        <span>
          {stages.find((stage) => stage.id === activeStage)?.description}
        </span>
      </div>
    </div>
  );
}
