"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PixelD20 } from "@/components/pixel-d20";
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
        <PixelD20>
          <path
            className="wordmark-die-focus"
            d="M12 2.5 26 5.5l4.5 14-11 9.5-13.5-3.5L1.5 12Z"
          />
        </PixelD20>
      </button>
      <Link href={href}>Rallypoint</Link>
      <span className="sr-only" aria-live="polite">
        {rolling ? `You rolled ${roll}${roll === 20 ? ". Critical path!" : "."}` : ""}
      </span>
    </div>
  );
}
