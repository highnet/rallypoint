import type { CSSProperties, ReactNode } from "react";

import type { SwarmTarget } from "../_lib/config-types";

/**
 * Line icons for the scaffold's routes, drawn on a 24px grid with a 1.75px
 * stroke. Routes you add get a neutral dot; map your own here by href.
 */
const paths: Record<string, ReactNode> = {
  "/swarm": <path d="M3 12h4l3-8 4 16 3-8h4" />,
  "/swarm/news": (
    <>
      <path d="M5 4h11a1 1 0 0 1 1 1v14a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" />
      <path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2" />
      <path d="M8 8h5M8 12h5M8 16h3" />
    </>
  ),
  "/swarm/targets": (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" />
    </>
  ),
  "/swarm/results": (
    <>
      <path d="M9 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" />
      <rect height="3" rx="1" width="6" x="9" y="3.5" />
      <path d="m9 13 2 2 4-4" />
    </>
  ),
  "/swarm/versions": (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v4a4 4 0 0 0 4 4h6" />
    </>
  ),
  "/swarm/buried": (
    <>
      <path d="M7 21v-9a5 5 0 0 1 10 0v9" />
      <path d="M4 21h16M12 9v6M10 11h4" />
    </>
  ),
  "/swarm/fleet": (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />
    </>
  ),
  "/swarm/sessions": (
    <>
      <rect height="11" rx="2" width="16" x="4" y="8" />
      <path d="M12 8V4M9 13h.01M15 13h.01M2 13h2M20 13h2" />
    </>
  ),
  "/swarm/rallypoint": (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8M8 6h4a4 4 0 0 1 4 4" />
    </>
  ),
  "/swarm/board": (
    <>
      <rect height="16" rx="1" width="16" x="4" y="4" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  "/swarm/messages": (
    <>
      <path d="M4 5h12v8H9l-3 3v-3H4z" />
      <path d="M16 9h4v8h-2v3l-3-3h-5v-2" />
    </>
  ),
  "/swarm/how-it-works": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  "/swarm/protocol": (
    <>
      <rect height="6" rx="1" width="6" x="3" y="3" />
      <rect height="6" rx="1" width="6" x="15" y="15" />
      <path d="M6 9v3a3 3 0 0 0 3 3h6" />
    </>
  ),
  "/swarm/concepts": (
    <>
      <rect height="16" rx="1" width="16" x="4" y="4" />
      <path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16" />
    </>
  ),
  "/swarm/skills": <path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6zM12 6v14.5" />,
};

export function NavIcon({ href }: { href: string }) {
  return (
    <svg
      aria-hidden="true"
      className="rp-icon"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="18"
    >
      {paths[href] ?? <circle cx="12" cy="12" r="2.5" />}
    </svg>
  );
}

export function ArrowIcon({ out }: { out?: boolean }) {
  return (
    <svg aria-hidden="true" className="rp-arrow" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
      {out ? <path d="M7 17 17 7M8 7h9v9" /> : <path d="M5 12h14M13 6l6 6-6 6" />}
    </svg>
  );
}

/** The style that carries a target's colour into its mark, card and chart. */
export function targetStyle(target: Pick<SwarmTarget, "color">): CSSProperties {
  return { "--rp-target": target.color } as CSSProperties;
}

/**
 * A target's mark: a tinted tile with the first letter of its name. Always
 * printed beside the name, so the colour never carries meaning alone.
 */
export function TargetMark({ target, size = "m" }: { target: SwarmTarget; size?: "s" | "m" | "l" }) {
  const letter = Array.from(target.name.trim() || target.id)[0]?.toUpperCase() ?? "·";
  return (
    <span aria-hidden="true" className={`rp-mark rp-mark-${size}`} style={targetStyle(target)}>
      {letter}
    </span>
  );
}
