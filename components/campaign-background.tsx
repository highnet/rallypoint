import type { CSSProperties } from "react";

import { agents, type Agent } from "@/lib/agents";

type CampaignBackgroundProps = {
  /**
   * Which role inhabits this view. Taken as a slug rather than an index into
   * the roster: this used to hold its own copy of the role order and pick the
   * portrait by position, so adding a role silently shifted every plate onto
   * the wrong creature.
   */
  role?: Agent["slug"];
  variant?: "hero" | "agent";
};

/**
 * The contract pages inherit the authored atlas instead of falling back to
 * abstract WebGL geometry. The landscape supplies place; the bestiary crop
 * supplies the role's inhabitant. Both remain decorative behind semantic copy.
 */
export function CampaignBackground({
  role = "planner",
  variant = "hero",
}: CampaignBackgroundProps) {
  // The marshal keeps its own camp. Keyed on the role itself rather than on a
  // position in the roster, for the same reason the portrait is.
  const isMarshal = role === "orchestrator";
  const portrait =
    agents.find((agent) => agent.slug === role)?.portrait ??
    "/world/roles/planner.jpg";

  return (
    <div
      aria-hidden="true"
      className={`campaign-background campaign-background-${variant} ${
        isMarshal ? "campaign-background-marshal" : ""
      }`}
    >
      <span
        className="campaign-landscape"
        style={{
          backgroundImage: isMarshal
            ? "url(/world/marshal-rally-camp.jpg)"
            : "url(/world/cindermoor-atlas.jpg)",
        }}
      />
      <span
        className="campaign-creature"
        style={
          {
            backgroundImage: `url(${portrait})`,
          } as CSSProperties
        }
      />
      <span className="campaign-ink-vignette" />
    </div>
  );
}
