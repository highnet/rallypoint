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
        <svg aria-hidden="true" viewBox="0 0 72 72">
          <path
            className="wordmark-die-focus"
            d="M36 3 58 10l11 21-9 23-24 15-24-10-9-22 10-24Z"
          />
          <g className="wordmark-die-faces">
            <path className="die-face die-face-1" d="M36 3 13 13l23 5Z" />
            <path className="die-face die-face-2" d="M36 3 36 18 58 10Z" />
            <path className="die-face die-face-3" d="M13 13 3 37l14-7Z" />
            <path className="die-face die-face-4" d="M13 13 17 30 36 18Z" />
            <path className="die-face die-face-5" d="M3 37 12 59 24 52Z" />
            <path className="die-face die-face-6" d="M3 37 24 52 17 30Z" />
            <path className="die-face die-face-7" d="M12 59 36 69 24 52Z" />
            <path className="die-face die-face-8" d="M36 69 48 49 24 52Z" />
            <path className="die-face die-face-9" d="M36 69 60 54 48 49Z" />
            <path className="die-face die-face-10" d="M60 54 69 31 54 29Z" />
            <path className="die-face die-face-11" d="M60 54 54 29 48 49Z" />
            <path className="die-face die-face-12" d="M69 31 58 10 54 29Z" />
            <path className="die-face die-face-13" d="M58 10 36 18 54 29Z" />
            <path className="die-face die-face-14" d="M36 18 17 30 36 35Z" />
            <path className="die-face die-face-main" d="M17 30 24 52 36 35Z" />
            <path className="die-face die-face-5" d="M24 52 48 49 36 35Z" />
            <path className="die-face die-face-10" d="M48 49 54 29 36 35Z" />
            <path className="die-face die-face-2" d="M54 29 36 18 36 35Z" />
          </g>
          <path
            className="wordmark-die-outline"
            d="M36 3 58 10l11 21-9 23-24 15-24-10-9-22 10-24Z"
          />
        </svg>
      </button>
      <Link href={href}>Rallypoint</Link>
      <span className="sr-only" aria-live="polite">
        {rolling ? `You rolled ${roll}${roll === 20 ? ". Critical path!" : "."}` : ""}
      </span>
    </div>
  );
}
