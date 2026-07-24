/**
 * Hidden sprite sheet of invented heraldic charges — one ink-stroke symbol per
 * agent role — plus the shared "struck edge" filter reserved for hero-scale
 * instances. Mounted once in the root layout; every consumer references a
 * charge with `<svg><use href="#charge-…" /></svg>`.
 */
export function HeraldrySprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ height: 0, overflow: "hidden", position: "absolute", width: 0 }}
    >
      <defs>
        <filter id="wax-edge" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            baseFrequency="0.9"
            numOctaves={2}
            result="wax-edge-noise"
            seed={7}
            type="fractalNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wax-edge-noise"
            scale={3}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      {/* Planner — bearing-star: a surveyor's compass mark */}
      <symbol
        id="charge-bearing-star"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 4 L29 21 L46 24 L29 27 L24 44 L19 27 L2 24 L19 21 Z" />
        <path d="M24 12 L24 17 M24 31 L24 36 M12 24 L17 24 M31 24 L36 24" />
        <circle cx="24" cy="24" r="2.4" />
      </symbol>

      {/* Worker — keystone-mark: the wedge that locks an arch */}
      <symbol
        id="charge-keystone-mark"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 6 H29 L37 42 H11 Z" />
        <path d="M24 6 V42" />
        <path d="M15 24 H33" />
      </symbol>

      {/* Reviewer — chop-seal: an official stamp of approval */}
      <symbol
        id="charge-chop-seal"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="30" height="30" rx="2" />
        <path d="M24 15 L33 24 L24 33 L15 24 Z" />
        <path d="M24 3 V8 M24 40 V45 M3 24 H8 M40 24 H45" />
      </symbol>

      {/* Tester — blaze-mark: a scout's trail notch */}
      <symbol
        id="charge-blaze-mark"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 6 L35 25 H13 Z" />
        <path d="M11 33 H37" />
      </symbol>

      {/* Fixer — stitch-mark: a mender's running suture */}
      <symbol
        id="charge-stitch-mark"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 24 H43" />
        <path d="M11 17 L17 31 M17 17 L11 31" />
        <path d="M21 17 L27 31 M27 17 L21 31" />
        <path d="M31 17 L37 31 M37 17 L31 31" />
      </symbol>

      {/* Janitor — ward-ring: a warded circle that clears stale claims */}
      <symbol
        id="charge-ward-ring"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="24" cy="24" r="16" />
        <path d="M24 3 V9 M24 39 V45 M3 24 H9 M39 24 H45" />
        <circle cx="24" cy="24" r="4" />
      </symbol>

      {/* Orchestrator — rally-point: converging roads meeting at the marshal */}
      <symbol
        id="charge-rally-point"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 24 L6 6 M24 24 L42 6 M24 24 L6 42 M24 24 L42 42" />
        <circle cx="24" cy="24" r="5" />
      </symbol>
    </svg>
  );
}
