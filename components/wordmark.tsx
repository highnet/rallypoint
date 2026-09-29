"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type WordmarkProps = {
  className?: string;
  href?: string;
};

export function Wordmark({ className, href = "/" }: WordmarkProps) {
  const [roll, setRoll] = useState(20);
  const [rolling, setRolling] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const rollDie = () => {
    const sample = new Uint32Array(1);
    crypto.getRandomValues(sample);
    setRoll((sample[0] % 20) + 1);
    setRolling(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setRolling(false), 900);
  };

  return (
    <div className={cn("wordmark", className)}>
      <button
        aria-label={`Roll the Rallypoint die. Current result: ${roll}`}
        className={cn("wordmark-die", rolling && "is-rolling", roll === 20 && "is-critical")}
        onClick={rollDie}
        title="Roll for initiative"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 25 25">
          <path
            className="wordmark-die-focus"
            d="M12.5 0 24 7.5v12L12.5 25 1 19.5v-12Z"
          />
          <g className="wordmark-die-pixels" shapeRendering="crispEdges">
            <path
              className="die-px-dark"
              d="M22 13h1v1h-1zM22 14h1v1h-1zM22 15h1v1h-1zM22 16h1v1h-1zM21 17h2v1h-2zM22 18h1v1h-1zM3 19h2v1h-2zM20 19h2v1h-2zM5 20h2v1h-2zM18 20h2v1h-2zM7 21h1v1h-1zM17 21h1v1h-1z"
            />
            <path
              className="die-px-mid"
              d="M14 6h1v1h-1zM14 7h7v1h-7zM15 8h8v1h-8zM15 9h7v1h-7zM16 10h6v1h-6zM17 11h5v1h-5zM17 12h5v1h-5zM2 13h1v1h-1zM18 13h3v1h-3zM2 14h1v1h-1zM19 14h2v1h-2zM2 15h1v1h-1zM19 15h2v1h-2zM2 16h1v1h-1zM20 16h1v1h-1zM2 17h2v1h-2zM2 18h1v1h-1zM7 19h11v1h-11zM8 20h9v1h-9zM9 21h7v1h-7zM11 22h3v1h-3zM12 23h1v1h-1z"
            />
            <path
              className="die-px-lo"
              d="M13 2h2v1h-2zM13 3h3v1h-3zM13 4h5v1h-5zM15 5h5v1h-5zM10 6h1v1h-1zM4 7h7v1h-7zM2 8h8v1h-8zM3 9h7v1h-7zM3 10h6v1h-6zM3 11h5v1h-5zM3 12h5v1h-5zM4 13h3v1h-3zM4 14h2v1h-2zM4 15h2v1h-2zM4 16h1v1h-1z"
            />
            <path
              className="die-px-hi"
              d="M10 2h2v1h-2zM9 3h3v1h-3zM7 4h5v1h-5zM5 5h5v1h-5z"
            />
            <path
              className="die-face-main"
              d="M12 6h1v1h-1zM12 7h1v1h-1zM11 8h3v1h-3zM11 9h3v1h-3zM10 10h5v1h-5zM9 11h7v1h-7zM9 12h7v1h-7zM8 13h1v1h-1zM12 13h1v1h-1zM16 13h1v1h-1zM7 14h4v1h-4zM12 14h1v1h-1zM14 14h1v1h-1zM16 14h2v1h-2zM7 15h2v1h-2zM12 15h1v1h-1zM14 15h1v1h-1zM16 15h2v1h-2zM6 16h3v1h-3zM10 16h3v1h-3zM14 16h1v1h-1zM16 16h3v1h-3zM6 17h3v1h-3zM12 17h1v1h-1zM16 17h3v1h-3z"
            />
            <path
              className="die-px-ink"
              d="M12 0h1v1h-1zM10 1h5v1h-5zM9 2h1v1h-1zM12 2h1v1h-1zM15 2h1v1h-1zM7 3h2v1h-2zM12 3h1v1h-1zM16 3h2v1h-2zM5 4h2v1h-2zM12 4h1v1h-1zM18 4h2v1h-2zM4 5h1v1h-1zM10 5h5v1h-5zM20 5h1v1h-1zM2 6h8v1h-8zM11 6h1v1h-1zM13 6h1v1h-1zM15 6h8v1h-8zM1 7h3v1h-3zM11 7h1v1h-1zM13 7h1v1h-1zM21 7h3v1h-3zM1 8h1v1h-1zM10 8h1v1h-1zM14 8h1v1h-1zM23 8h1v1h-1zM1 9h2v1h-2zM10 9h1v1h-1zM14 9h1v1h-1zM22 9h2v1h-2zM1 10h2v1h-2zM9 10h1v1h-1zM15 10h1v1h-1zM22 10h2v1h-2zM1 11h2v1h-2zM8 11h1v1h-1zM16 11h1v1h-1zM22 11h2v1h-2zM1 12h2v1h-2zM8 12h1v1h-1zM16 12h1v1h-1zM22 12h2v1h-2zM1 13h1v1h-1zM3 13h1v1h-1zM7 13h1v1h-1zM9 13h3v1h-3zM13 13h3v1h-3zM17 13h1v1h-1zM21 13h1v1h-1zM23 13h1v1h-1zM1 14h1v1h-1zM3 14h1v1h-1zM6 14h1v1h-1zM11 14h1v1h-1zM13 14h1v1h-1zM15 14h1v1h-1zM18 14h1v1h-1zM21 14h1v1h-1zM23 14h1v1h-1zM1 15h1v1h-1zM3 15h1v1h-1zM6 15h1v1h-1zM9 15h3v1h-3zM13 15h1v1h-1zM15 15h1v1h-1zM18 15h1v1h-1zM21 15h1v1h-1zM23 15h1v1h-1zM1 16h1v1h-1zM3 16h1v1h-1zM5 16h1v1h-1zM9 16h1v1h-1zM13 16h1v1h-1zM15 16h1v1h-1zM19 16h1v1h-1zM21 16h1v1h-1zM23 16h1v1h-1zM1 17h1v1h-1zM4 17h2v1h-2zM9 17h3v1h-3zM13 17h3v1h-3zM19 17h2v1h-2zM23 17h1v1h-1zM1 18h1v1h-1zM3 18h19v1h-19zM23 18h1v1h-1zM1 19h2v1h-2zM5 19h2v1h-2zM18 19h2v1h-2zM22 19h2v1h-2zM3 20h2v1h-2zM7 20h1v1h-1zM17 20h1v1h-1zM20 20h2v1h-2zM5 21h2v1h-2zM8 21h1v1h-1zM16 21h1v1h-1zM18 21h2v1h-2zM7 22h4v1h-4zM14 22h4v1h-4zM9 23h3v1h-3zM13 23h3v1h-3zM11 24h3v1h-3z"
            />
          </g>
        </svg>
      </button>
      <Link href={href}>Rallypoint</Link>
      <span className="sr-only" aria-live="polite">
        {rolling ? `You rolled ${roll}${roll === 20 ? ". Critical path!" : "."}` : ""}
      </span>
    </div>
  );
}
