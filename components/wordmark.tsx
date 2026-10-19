import Link from "next/link";

import { SignalFlag } from "@/components/signal-flag";
import { cn } from "@/lib/utils";

type WordmarkProps = {
  className?: string;
  href?: string;
};

export function Wordmark({ className, href = "/" }: WordmarkProps) {
  return (
    <Link aria-label="Rallypoint home" className={cn("wordmark", className)} href={href}>
      <SignalFlag className="wordmark-flag" signal="rallypoint" />
      <span>Rallypoint</span>
    </Link>
  );
}
