import type { AgentSlug } from "@/lib/agents";
import { cn } from "@/lib/utils";

export type SignalId = AgentSlug | "rallypoint";

type SignalFlagProps = {
  signal: SignalId;
  className?: string;
  /** Accessible name. Omit when the role name is printed beside the flag. */
  title?: string;
};

/**
 * One square signal per role, drawn in the geometry of the International Code
 * of Signals: five colours, straight divisions, no gradients. Every flag is
 * always printed beside its role name, so colour never carries meaning alone.
 */
const fields: Record<SignalId, React.ReactNode> = {
  // Saltire converging on a centre square: every route meets here.
  orchestrator: (
    <>
      <rect className="sf-w" height="24" width="24" />
      <path className="sf-b" d="M0 0h4.2L24 19.8V24h-4.2L0 4.2zM24 0v4.2L4.2 24H0v-4.2L19.8 0z" />
      <rect className="sf-r" height="8" width="8" x="8" y="8" />
    </>
  ),
  planner: (
    <>
      <rect className="sf-b" height="24" width="24" />
      <rect className="sf-w" height="8" width="24" y="8" />
    </>
  ),
  worker: (
    <>
      <rect className="sf-y" height="24" width="12" />
      <rect className="sf-b" height="24" width="12" x="12" />
    </>
  ),
  reviewer: (
    <>
      <rect className="sf-r" height="24" width="24" />
      <rect className="sf-w" height="14" width="14" x="5" y="5" />
    </>
  ),
  tester: (
    <>
      <rect className="sf-y" height="24" width="24" />
      <circle className="sf-k" cx="12" cy="12" r="5.5" />
    </>
  ),
  fixer: (
    <>
      <rect className="sf-b" height="24" width="24" />
      <path className="sf-y" d="M12 0h12v12H12zM0 12h12v12H0z" />
    </>
  ),
  janitor: (
    <>
      <rect className="sf-y" height="24" width="24" />
      <path className="sf-k" d="M0 0v24h24z" />
    </>
  ),
  merger: (
    <>
      <rect className="sf-r" height="24" width="24" />
      <path className="sf-w" d="M9.5 0h5v24h-5zM0 9.5h24v5H0z" />
    </>
  ),
  // A rising chevron: the loop climbing on its own measured results.
  improver: (
    <>
      <rect className="sf-w" height="24" width="24" />
      <path className="sf-b" d="M0 24L12 6l12 18h-6.5L12 15.5 6.5 24z" />
    </>
  ),
  // Four fields meeting at one point: the Rallypoint mark.
  rallypoint: (
    <>
      <path className="sf-r" d="M0 0h24L12 12z" />
      <path className="sf-y" d="M24 0v24L12 12z" />
      <path className="sf-b" d="M24 24H0l12-12z" />
      <path className="sf-k" d="M0 24V0l12 12z" />
    </>
  ),
};

export function SignalFlag({ signal, className, title }: SignalFlagProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={cn("signal-flag", className)}
      role={title ? "img" : undefined}
      viewBox="0 0 24 24"
    >
      {title ? <title>{title}</title> : null}
      {fields[signal]}
      <rect className="sf-edge" height="23" width="23" x="0.5" y="0.5" />
    </svg>
  );
}
