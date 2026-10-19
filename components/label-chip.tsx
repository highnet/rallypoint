import type { CSSProperties } from "react";

import { labelSpecs, labelTextColor, type LabelKey } from "@/lib/labels";
import { cn } from "@/lib/utils";

type LabelChipProps = {
  label: LabelKey;
  className?: string;
  muted?: boolean;
};

/** A GitHub label, rendered the way GitHub renders it. */
export function LabelChip({ label, className, muted }: LabelChipProps) {
  const spec = labelSpecs[label];
  const style = {
    "--chip-bg": `#${spec.color}`,
    "--chip-fg": labelTextColor(spec.color),
  } as CSSProperties;

  return (
    <span className={cn("label-chip", muted && "is-muted", className)} style={style}>
      {spec.name}
    </span>
  );
}
