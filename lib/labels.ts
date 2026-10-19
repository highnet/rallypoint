/**
 * Default label names from .rallypoint/config.json and their meanings from
 * docs/AGENT_LOOP.md. Colours are the ones `rallypoint init` creates; labels
 * init does not create render in GitHub's neutral grey.
 */
export type LabelSpec = {
  name: string;
  configKey?: string;
  color: string;
  meaning: string;
  scope: "issue" | "pull request" | "issue or PR";
};

export const labelSpecs = {
  claimed: {
    name: "status:claimed",
    configKey: "claimed",
    color: "fbca04",
    meaning: "Reserved by one worker right now.",
    scope: "issue",
  },
  blocked: {
    name: "status:blocked",
    configKey: "blocked",
    color: "d93f0b",
    meaning: "Waiting on another issue, named in a Blocked-By: trailer.",
    scope: "issue",
  },
  deferred: {
    name: "status:deferred",
    configKey: "deferred",
    color: "ededed",
    meaning: "A deliberate hold that will not clear on its own.",
    scope: "issue",
  },
  human: {
    name: "needs:human",
    configKey: "human",
    color: "5319e7",
    meaning: "Requires an owner decision or a protected action.",
    scope: "issue or PR",
  },
  approved: {
    name: "review:approved",
    configKey: "approved",
    color: "0e8a16",
    meaning: "Reviewer verdict on a pull request, bound to its head SHA.",
    scope: "pull request",
  },
  changesRequested: {
    name: "status:changes-requested",
    configKey: "changesRequested",
    color: "ededed",
    meaning: "A reviewer asked for changes and they are outstanding.",
    scope: "pull request",
  },
  mergedUnreviewed: {
    name: "merged:unreviewed",
    configKey: "mergedUnreviewed",
    color: "ededed",
    meaning: "Merged without an approve verdict at its head.",
    scope: "pull request",
  },
  p1: {
    name: "prio:p1",
    color: "d93f0b",
    meaning: "Priority. claim.mjs orders the claimable pool by this number and nothing else.",
    scope: "issue",
  },
} satisfies Record<string, LabelSpec>;

export type LabelKey = keyof typeof labelSpecs;

/** GitHub picks black or white label text by the background's lightness. */
export function labelTextColor(hex: string) {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.2 ? "#1f2328" : "#ffffff";
}
