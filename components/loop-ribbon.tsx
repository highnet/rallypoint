"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import { agentSlugForRole, loopStages } from "@/lib/loop-stages";
import { useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function LoopRibbon() {
  const activeStage = useRallypointStore((state) => state.activeStage);
  const setActiveStage = useRallypointStore((state) => state.setActiveStage);
  const active = loopStages.find((stage) => stage.id === activeStage) ?? loopStages[0];

  return (
    <div className="loop-ribbon" aria-label="Rallypoint workflow">
      {loopStages.map((stage, index) => {
        const isActive = activeStage === stage.id;
        const accentStyle = { "--accent": stage.accent } as CSSProperties;

        return (
          <button
            aria-expanded={isActive}
            className={cn("loop-step", isActive && "is-active")}
            data-stage={stage.id}
            key={stage.id}
            onClick={() => setActiveStage(stage.id)}
            style={accentStyle}
            type="button"
          >
            <span className="loop-step-number">{index + 1}</span>
            <strong>{stage.shortLabel}</strong>
            {index < loopStages.length - 1 && (
              <ArrowRight aria-hidden="true" className="loop-step-arrow" />
            )}
          </button>
        );
      })}

      <div className="loop-step-detail" aria-live="polite">
        <p>{active.description}</p>
        <Link href={`/agents/${agentSlugForRole(active.role)}`}>
          View {active.role} role
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
