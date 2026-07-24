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
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <g className="wordmark-die-facets">
            <path d="M16 3 7 9 16 9Z" />
            <path d="M16 3 16 9 25 9Z" />
            <path d="M7 9 5 19 16 24Z" />
            <path d="M7 9 16 24 25 9Z" className="wordmark-die-front" />
            <path d="M16 24 25 9 27 19Z" />
            <path d="M16 29 5 19 16 24Z" />
            <path d="M16 29 16 24 27 19Z" />
          </g>
          <path
            className="wordmark-die-outline"
            d="M16 3 25 9 27 19 16 29 5 19 7 9Z"
          />
          <text x="16" y="20.5" textAnchor="middle">
            {roll}
          </text>
        </svg>
      </button>
      <Link href={href}>Rallypoint</Link>
      <span className="sr-only" aria-live="polite">
        {rolling ? `You rolled ${roll}${roll === 20 ? ". Critical path!" : "."}` : ""}
      </span>
    </div>
  );
}
