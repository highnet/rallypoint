"use client";

import { ArrowRight, MousePointerClick } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import { agentSlugForRole, loopStages } from "@/lib/loop-stages";
import { useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function TabletopLoop() {
  const activeStage = useRallypointStore((state) => state.activeStage);
  const setActiveStage = useRallypointStore((state) => state.setActiveStage);
  const activeIndex = loopStages.findIndex((stage) => stage.id === activeStage);
  const active = loopStages[activeIndex] ?? loopStages[0];
  const routeStyle = {
    "--route-offset": `${100 - (activeIndex + 1) * 20}`,
  } as CSSProperties;

  const legendContent = (
    <>
      <span className="legend-title">{active.label}</span>
      <span>{active.description}</span>
      <Link className="legend-link" href={`/agents/${agentSlugForRole(active.role)}`}>
        View {active.role} role
        <ArrowRight aria-hidden="true" />
      </Link>
    </>
  );

  return (
    <div className="campaign-table-wrap">
      <p className="map-hint">
        <MousePointerClick aria-hidden="true" />
        Tap a stage to preview it, then open its role
      </p>
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
          <path
            className="route-progress"
            d="M210 190 C390 75 570 80 700 135 C890 215 925 410 790 535 C650 665 350 640 205 520 C90 425 82 280 210 190 Z"
            pathLength="100"
            style={routeStyle}
          />
        </svg>

        {loopStages.map((stage) => {
          const Icon = stage.icon;
          const isActive = activeStage === stage.id;

          return (
            <button
              aria-pressed={isActive}
              className={cn("map-stage", isActive && "is-active")}
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

        <div className="map-legend map-legend-overlay" aria-live="polite">
          {legendContent}
        </div>
      </div>
      <div className="map-legend map-legend-static" aria-live="polite">
        {legendContent}
      </div>
    </div>
  );
}
