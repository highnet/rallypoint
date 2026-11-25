import type { ReactNode } from "react";

/**
 * 16px line icons for the navigation, drawn on a 16-unit grid with a 1.4
 * stroke so they sit on the text's x-height. Keyed by route; a route you add
 * yourself gets the neutral dot unless you add a glyph here.
 */
const GLYPHS: Record<string, ReactNode> = {
  "/swarm": <path d="M1.5 9.5h2.5l2-5 3 8 2-5h3" />,
  "/swarm/news": (
    <>
      <rect height="11" rx="1.5" width="12" x="2" y="2.5" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" />
    </>
  ),
  "/swarm/targets": (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  "/swarm/results": (
    <>
      <rect height="11" rx="1.5" width="11" x="2.5" y="2.5" />
      <path d="M5.5 8.2l1.8 1.8 3.4-3.6" />
    </>
  ),
  "/swarm/versions": (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="6.5" r="1.5" />
      <path d="M4.5 5v6M11.5 8c0 2.5-3 2.5-6.2 3.6" />
    </>
  ),
  "/swarm/buried": (
    <>
      <path d="M4 14V6.5a4 4 0 0 1 8 0V14" />
      <path d="M2.5 14h11M6.5 8.5h3M8 7v4" />
    </>
  ),
  "/swarm/fleet": (
    <>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13.5c0-2.3 1.8-4 4-4s4 1.7 4 4" />
      <path d="M10.5 3.5a2.2 2.2 0 0 1 0 4.2M12 9.8c1.3.5 2.2 1.9 2.2 3.7" />
    </>
  ),
  "/swarm/sessions": (
    <>
      <circle cx="8" cy="8.5" r="5.5" />
      <path d="M8 5.5v3l2 1.5M6.5 1.5h3" />
    </>
  ),
  "/swarm/rallypoint": <path d="M3.5 14.5V2M3.5 2.5h9l-2 3 2 3h-9" />,
  "/swarm/board": (
    <>
      <rect height="11" rx="1.5" width="12" x="2" y="2.5" />
      <path d="M6 2.5v11M10 2.5v11" />
    </>
  ),
  "/swarm/messages": <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />,
  "/swarm/how-it-works": (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M10.2 5.8L9 9 5.8 10.2 7 7z" />
    </>
  ),
  "/swarm/protocol": (
    <>
      <path d="M4 1.5h5.5L12 4v10.5H4z" />
      <path d="M6 7h4M6 9.5h4M6 12h2.5" />
    </>
  ),
  "/swarm/concepts": (
    <>
      <rect height="4.5" rx="1" width="4.5" x="2" y="2" />
      <rect height="4.5" rx="1" width="4.5" x="9.5" y="2" />
      <rect height="4.5" rx="1" width="4.5" x="2" y="9.5" />
      <rect height="4.5" rx="1" width="4.5" x="9.5" y="9.5" />
    </>
  ),
  "/swarm/skills": <path d="M8 4c-1.5-1.2-3.5-1.5-5.5-1.5v10c2 0 4 .3 5.5 1.5 1.5-1.2 3.5-1.5 5.5-1.5v-10C11.5 2.5 9.5 2.8 8 4zM8 4v10" />,
};

export function NavIcon({ href }: { href: string }) {
  const glyph = GLYPHS[href] ?? <circle cx="8" cy="8" r="2" />;
  return (
    <svg aria-hidden="true" className="rp-icon" fill="none" height="16" viewBox="0 0 16 16" width="16">
      {glyph}
    </svg>
  );
}

export function ArrowRight() {
  return (
    <svg aria-hidden="true" className="rp-arrow" fill="none" height="12" viewBox="0 0 12 12" width="12">
      <path d="M1.5 6h8.5M6.5 2.5L10 6l-3.5 3.5" />
    </svg>
  );
}

export function ArrowUpRight() {
  return (
    <svg aria-hidden="true" className="rp-arrow" fill="none" height="12" viewBox="0 0 12 12" width="12">
      <path d="M3 9l6-6M4 3h5v5" />
    </svg>
  );
}
