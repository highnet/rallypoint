"use client";

import { Check, Copy, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type CommandCopyProps = {
  className?: string;
  command: string;
  id: string;
};

export function CommandCopy({ className, command, id }: CommandCopyProps) {
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
      timeoutRef.current = window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className={cn("command-well", className)}>
      <Terminal aria-hidden="true" className="command-icon" />
      <code>{command}</code>
      <span className="copy-status" aria-live="polite">
        {isCopied ? "Quest copied" : ""}
      </span>
      <Button
        aria-label={isCopied ? "Command copied" : "Copy install command"}
        className="command-copy-button"
        onClick={copy}
        size="icon"
        variant="ghost"
      >
        {isCopied ? <Check className="copy-check" /> : <Copy />}
      </Button>
    </div>
  );
}
