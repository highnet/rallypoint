import { BookOpen, CheckCircle2, Flag, GitPullRequest, Hammer } from "lucide-react";
import type { ComponentType } from "react";

import type { LoopStage as LoopStageId } from "@/lib/store";

export type LoopStage = {
  id: LoopStageId;
  label: string;
  shortLabel: string;
  role: string;
  description: string;
  x: number;
  y: number;
  token: string;
  accent: string;
  icon: ComponentType<{ className?: string }>;
};

export const loopStages: LoopStage[] = [
  {
    id: "read",
    label: "Read state",
    shortLabel: "Read state",
    role: "Planner",
    description: "Survey the roadmap, issues, pull requests, and repository rules.",
    x: 20,
    y: 29,
    token: "token-round",
    accent: "var(--parchment-emphasis)",
    icon: BookOpen,
  },
  {
    id: "claim",
    label: "Claim quest",
    shortLabel: "Claim",
    role: "Worker",
    description: "Atomically reserve one ready issue before touching code.",
    x: 63,
    y: 15,
    token: "token-triangle",
    accent: "var(--red)",
    icon: Flag,
  },
  {
    id: "build",
    label: "Build",
    shortLabel: "Build",
    role: "Worker",
    description: "Create one branch, complete one issue, and keep the checks green.",
    x: 86,
    y: 48,
    token: "token-square",
    accent: "var(--blue)",
    icon: Hammer,
  },
  {
    id: "review",
    label: "Face review",
    shortLabel: "Review",
    role: "Reviewer",
    description: "A separate agent judges the diff against the quest and the rules.",
    x: 60,
    y: 79,
    token: "token-star",
    accent: "var(--amber)",
    icon: GitPullRequest,
  },
  {
    id: "merge",
    label: "Merge",
    shortLabel: "Merge",
    role: "Merger",
    description: "The verdict and the checks are read together, then the work crosses.",
    x: 21,
    y: 66,
    token: "token-keystone",
    accent: "var(--brass)",
    icon: CheckCircle2,
  },
];

export function agentSlugForRole(role: string) {
  return role.toLowerCase();
}
