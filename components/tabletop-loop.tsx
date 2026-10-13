"use client";

import { ArrowRight, MapPinned } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";

import { PixelD20 } from "@/components/pixel-d20";
import { cn } from "@/lib/utils";

const atlasLocations = [
  {
    slug: "planner",
    role: "Planner",
    name: "Star Tower",
    motto: "Chart the unknown.",
    detail:
      "Astrolabes turn above the observatory while the cartographer plots ready quests and their dependencies.",
    x: 30,
    y: 19,
  },
  {
    slug: "worker",
    role: "Worker",
    name: "Emberworks",
    motto: "Shape one quest.",
    detail:
      "Forges, cranes, and molten channels turn a claimed issue into one focused, verifiable pull request.",
    x: 67,
    y: 19,
  },
  {
    slug: "reviewer",
    role: "Reviewer",
    name: "Owl Scriptorium",
    motto: "Judge the evidence.",
    detail:
      "Lanterned archives hold the contract, the diff, and the independent verdict that guards the merge.",
    x: 70,
    y: 49,
  },
  {
    slug: "tester",
    role: "Tester",
    name: "Thornwood",
    motto: "Test the edges.",
    detail:
      "Broken bridges and hostile paths reveal the weakest meaningful behavior before it escapes into the wild.",
    x: 65,
    y: 77,
  },
  {
    slug: "fixer",
    role: "Fixer",
    name: "Red Apothecary",
    motto: "Mend, don’t expand.",
    detail:
      "Glasshouses and careful instruments restore a reviewed branch without broadening the original quest.",
    x: 38,
    y: 80,
  },
  {
    slug: "merger",
    role: "Merger",
    name: "Brass Ford",
    motto: "Read the water first.",
    detail:
      "The one crossing on the map. The ferryman reads the verdict, then the checks themselves, before carrying anything over.",
    x: 18,
    y: 66,
  },
  {
    slug: "janitor",
    role: "Janitor",
    name: "Barrow of Keys",
    motto: "Leave a truthful trail.",
    detail:
      "The keeper clears abandoned claims and stale reservations so the campaign board reflects the living work.",
    x: 17,
    y: 39,
  },
] as const;

export function TabletopLoop() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = atlasLocations[activeIndex];
  // The ember route advances from 80 to 0 across the whole ring, so the step is
  // derived from the number of locations rather than fixed at 16. Hard-coding
  // the step meant a seventh location ran the offset negative and the route
  // stopped tracking the selection at all.
  const routeStyle = {
    "--route-offset": `${
      80 - (activeIndex * 80) / Math.max(atlasLocations.length - 1, 1)
    }`,
  } as CSSProperties;

  return (
    <div className="campaign-table-wrap">
      <div className="atlas-heading">
        <p>
          <MapPinned aria-hidden="true" />
          The Cindermoor Reaches
        </p>
        <span>Select a stronghold to inspect its oath</span>
      </div>

      <div className="campaign-table" aria-label="The six inhabited role locations of Rallypoint">
        <div className="atlas-art" aria-hidden="true" />
        <svg
          aria-hidden="true"
          className="route-map"
          preserveAspectRatio="none"
          viewBox="0 0 1000 660"
        >
          <path
            className="route-shadow"
            d="M300 130 C470 55 610 55 680 125 C760 205 775 275 700 325 C760 405 750 505 650 540 C485 610 345 570 280 500 C190 430 145 350 185 285 C205 220 240 170 300 130 Z"
          />
          <path
            className="route-track"
            d="M300 130 C470 55 610 55 680 125 C760 205 775 275 700 325 C760 405 750 505 650 540 C485 610 345 570 280 500 C190 430 145 350 185 285 C205 220 240 170 300 130 Z"
          />
          <path
            className="route-line"
            d="M300 130 C470 55 610 55 680 125 C760 205 775 275 700 325 C760 405 750 505 650 540 C485 610 345 570 280 500 C190 430 145 350 185 285 C205 220 240 170 300 130 Z"
          />
          <path
            className="route-progress"
            d="M300 130 C470 55 610 55 680 125 C760 205 775 275 700 325 C760 405 750 505 650 540 C485 610 345 570 280 500 C190 430 145 350 185 285 C205 220 240 170 300 130 Z"
            pathLength="100"
            style={routeStyle}
          />
        </svg>

        {atlasLocations.map((location, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              aria-label={`${location.role}: ${location.name}. ${location.motto}`}
              aria-pressed={isActive}
              className={cn("map-stage", `atlas-location-${index + 1}`, isActive && "is-active")}
              key={location.slug}
              onClick={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              style={{ left: `${location.x}%`, top: `${location.y}%` }}
              type="button"
            >
              <span className="atlas-pin" aria-hidden="true">
                {index + 1}
              </span>
              <span className="stage-copy">
                <span className="stage-role">{location.role}</span>
                <span className="stage-heading">{location.name}</span>
                <span className="stage-motto">{location.motto}</span>
              </span>
            </button>
          );
        })}

        <div className="atlas-die" aria-hidden="true">
          <PixelD20 className="atlas-die-svg" />
        </div>

      </div>
      <div className="map-legend atlas-field-note" aria-live="polite">
        <span className="legend-index">Field note {activeIndex + 1}/6</span>
        <span className="legend-title">
          {active.role} · {active.name}
        </span>
        <span>{active.detail}</span>
        <Link className="legend-link" href={`/agents/${active.slug}`}>
          Open the {active.role} contract
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
