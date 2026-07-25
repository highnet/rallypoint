import type { CSSProperties } from "react";

type CampaignBackgroundProps = {
  focus?: number;
  variant?: "hero" | "agent";
};

/**
 * The contract pages inherit the authored atlas instead of falling back to
 * abstract WebGL geometry. The landscape supplies place; the bestiary crop
 * supplies the role's inhabitant. Both remain decorative behind semantic copy.
 */
export function CampaignBackground({
  focus = 0,
  variant = "hero",
}: CampaignBackgroundProps) {
  const portraitNames = [
    "planner",
    "worker",
    "reviewer",
    "tester",
    "fixer",
    "janitor",
    "orchestrator",
  ];
  const portraitName = portraitNames[Math.min(focus, 6)];

  return (
    <div
      aria-hidden="true"
      className={`campaign-background campaign-background-${variant} ${
        focus > 5 ? "campaign-background-marshal" : ""
      }`}
    >
      <span
        className="campaign-landscape"
        style={{
          backgroundImage:
            focus > 5
              ? "url(/world/marshal-rally-camp.jpg)"
              : "url(/world/cindermoor-atlas.jpg)",
        }}
      />
      <span
        className="campaign-creature"
        style={
          {
            backgroundImage: `url(/world/roles/${portraitName}.jpg)`,
          } as CSSProperties
        }
      />
      <span className="campaign-ink-vignette" />
    </div>
  );
}
