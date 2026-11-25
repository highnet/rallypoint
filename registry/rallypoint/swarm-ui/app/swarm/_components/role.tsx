import type { ReactNode } from "react";

/**
 * Rallypoint's role signals: one square flag per role, drawn in the geometry
 * of the International Code of Signals with five inks. A flag is always
 * printed beside its role name, so colour never carries meaning alone.
 */

export const ROLES = [
  "merger",
  "fixer",
  "reviewer",
  "improver",
  "worker",
  "planner",
  "janitor",
  "tester",
  "orchestrator",
] as const;

export type Role = (typeof ROLES)[number];

const fields: Record<Role | "unknown", ReactNode> = {
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
  improver: (
    <>
      <rect className="sf-w" height="24" width="24" />
      <path className="sf-b" d="M0 24L12 6l12 18h-6.5L12 15.5 6.5 24z" />
    </>
  ),
  // A role this UI does not know: a plain white field.
  unknown: <rect className="sf-w" height="24" width="24" />,
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function SignalFlag({ role, size = 18 }: { role: string; size?: number }) {
  const key = isRole(role) ? role : "unknown";
  return (
    <svg aria-hidden="true" className="rp-flag" height={size} viewBox="0 0 24 24" width={size}>
      {fields[key]}
      <rect className="sf-edge" height="23" width="23" x="0.5" y="0.5" />
    </svg>
  );
}

/** A role's flag paired with its name. */
export function RoleTag({ role }: { role: string | null | undefined }) {
  if (!role) return <span className="rp-soft">—</span>;
  return (
    <span className="rp-role">
      <SignalFlag role={role} />
      <span>{role}</span>
    </span>
  );
}
