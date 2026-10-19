"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef } from "react";

import { useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type CommandCopyProps = {
  className?: string;
  command: string;
  id: string;
  /** What the copy button names, e.g. "install command" or "prompt". */
  label?: string;
  /** Show the shell prompt marker. Off for prose prompts. */
  shell?: boolean;
};

export function CommandCopy({
  className,
  command,
  id,
  label = "command",
  shell = true,
}: CommandCopyProps) {
  const copied = useRallypointStore((state) => state.copied);
  const setCopied = useRallypointStore((state) => state.setCopied);
  const isCopied = copied === id;
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(id);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className={cn("command", !shell && "command-prose", isCopied && "is-copied", className)}>
      <code>
        {shell ? (
          <span aria-hidden="true" className="command-prompt">
            $
          </span>
        ) : null}
        {command}
      </code>
      <button
        aria-label={isCopied ? `Copied ${label}` : `Copy ${label}`}
        className="command-copy"
        onClick={copy}
        type="button"
      >
        {isCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span className="command-copy-text">{isCopied ? "Copied" : "Copy"}</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {isCopied ? `Copied ${label} to clipboard` : ""}
      </span>
    </div>
  );
}
