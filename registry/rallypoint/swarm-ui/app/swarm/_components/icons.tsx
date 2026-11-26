import type { CSSProperties, ReactNode } from "react";

import type { NavIconName, SwarmNavItem, SwarmTarget } from "../_lib/config-types";

/**
 * Line icons for the nav, drawn on a 24px grid with a 1.75px stroke. Each has
 * a name a `swarm.config.ts` nav item can pick with `icon`; the scaffold's own
 * routes are mapped to theirs by href in `routeIcons` below.
 */
const icons: Record<NavIconName, ReactNode> = {
  // The scaffold's own routes.
  pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  news: (
    <>
      <path d="M5 4h11a1 1 0 0 1 1 1v14a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" />
      <path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2" />
      <path d="M8 8h5M8 12h5M8 16h3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" />
      <rect height="3" rx="1" width="6" x="9" y="3.5" />
      <path d="m9 13 2 2 4-4" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v4a4 4 0 0 0 4 4h6" />
    </>
  ),
  grave: (
    <>
      <path d="M7 21v-9a5 5 0 0 1 10 0v9" />
      <path d="M4 21h16M12 9v6M10 11h4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />
    </>
  ),
  robot: (
    <>
      <rect height="11" rx="2" width="16" x="4" y="8" />
      <path d="M12 8V4M9 13h.01M15 13h.01M2 13h2M20 13h2" />
    </>
  ),
  merge: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8M8 6h4a4 4 0 0 1 4 4" />
    </>
  ),
  list: (
    <>
      <rect height="16" rx="1" width="16" x="4" y="4" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h12v8H9l-3 3v-3H4z" />
      <path d="M16 9h4v8h-2v3l-3-3h-5v-2" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  flow: (
    <>
      <rect height="6" rx="1" width="6" x="3" y="3" />
      <rect height="6" rx="1" width="6" x="15" y="15" />
      <path d="M6 9v3a3 3 0 0 0 3 3h6" />
    </>
  ),
  grid: (
    <>
      <rect height="16" rx="1" width="16" x="4" y="4" />
      <path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16" />
    </>
  ),
  book: <path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6zM12 6v14.5" />,

  // For the routes a project adds.
  brush: (
    <>
      <path d="M18.5 3.5a2.12 2.12 0 0 1 3 3L13 15l-3-3z" />
      <path d="M9.5 12.5C7.5 12.5 6 14 6 16c0 1.5-1 2.5-3 3 1.5 1.5 3 2 4.5 2a4 4 0 0 0 4-4" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13h4.5l1.5 3h4l1.5-3H20" />
      <path d="M6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  card: (
    <>
      <rect height="13" rx="2" width="18" x="3" y="5.5" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  mail: (
    <>
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </>
  ),
  page: (
    <>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4" />
    </>
  ),
};

/** The icon each scaffold route gets when its nav item names none. */
const routeIcons: Record<string, NavIconName> = {
  "/swarm": "pulse",
  "/swarm/news": "news",
  "/swarm/targets": "target",
  "/swarm/results": "clipboard",
  "/swarm/versions": "branch",
  "/swarm/buried": "grave",
  "/swarm/fleet": "people",
  "/swarm/sessions": "robot",
  "/swarm/rallypoint": "merge",
  "/swarm/board": "list",
  "/swarm/messages": "chat",
  "/swarm/how-it-works": "compass",
  "/swarm/protocol": "flow",
  "/swarm/concepts": "grid",
  "/swarm/skills": "book",
};

const isIconName = (name: unknown): name is NavIconName =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(icons, name);

/**
 * Which icon a nav item gets, in this order: the item's own `icon`; the
 * scaffold route's icon for its href; `target` for a single target's page
 * (`/swarm/targets/<id>`); `page` for any other path in the app. Only an href
 * that is not a path, such as an external link, falls back to a dot.
 *
 * A target page gets the line icon rather than its `TargetMark`: the mark is a
 * 22px filled tile, which sits off the 18px icon column of the sections above,
 * and the targets list at the foot of the nav already shows each mark.
 */
export function navIconName(item: Pick<SwarmNavItem, "href" | "icon">): NavIconName | null {
  if (isIconName(item.icon)) return item.icon;
  const route = routeIcons[item.href];
  if (route) return route;
  if (item.href.startsWith("/swarm/targets/")) return "target";
  if (item.href.startsWith("/")) return "page";
  return null;
}

export function NavIcon({ item }: { item: Pick<SwarmNavItem, "href" | "icon"> }) {
  const name = navIconName(item);
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
      {name ? icons[name] : <circle cx="12" cy="12" r="2.5" />}
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
