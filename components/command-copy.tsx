"use client";

import { Check, Copy, Terminal } from "lucide-react";

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

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className={cn("command-well", className)}>
      <Terminal aria-hidden="true" className="command-icon" />
      <code>{command}</code>
      <Button
        aria-label={isCopied ? "Command copied" : "Copy install command"}
        className="command-copy-button"
        onClick={copy}
        size="icon"
        variant="ghost"
      >
        {isCopied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
