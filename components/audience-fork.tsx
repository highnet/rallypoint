"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { CommandCopy } from "@/components/command-copy";
import { SignalFlag } from "@/components/signal-flag";
import { agents } from "@/lib/agents";
import { useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type AudienceForkProps = {
  human: ReactNode;
};

export function AudienceSwitch() {
  const audience = useRallypointStore((state) => state.audience);
  const setAudience = useRallypointStore((state) => state.setAudience);

  return (
    <div aria-label="Read this page as" className="audience-switch" role="tablist">
      {(["human", "agent"] as const).map((option) => (
        <button
          aria-controls="audience-content"
          aria-selected={audience === option}
          className={cn(audience === option && "is-selected")}
          key={option}
          onClick={() => setAudience(option)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              const next = option === "human" ? "agent" : "human";
              setAudience(next);
              document.getElementById(`audience-${next}`)?.focus();
            }
          }}
          id={`audience-${option}`}
          role="tab"
          tabIndex={audience === option ? 0 : -1}
          type="button"
        >
          {option === "human" ? "I’m a human" : "I’m an agent"}
        </button>
      ))}
    </div>
  );
}

export function AudienceFork({ human }: AudienceForkProps) {
  const audience = useRallypointStore((state) => state.audience);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.audience = audience;
    return () => {
      if (root.dataset.audience === audience) delete root.dataset.audience;
    };
  }, [audience]);

  return (
    <div
      aria-labelledby={`audience-${audience}`}
      className="audience-panel"
      id="audience-content"
      role="tabpanel"
    >
      {audience === "human" ? (
        human
      ) : (
        <div className="agent-quickstart">
          <h1>Read the contract. Pick one role. Respect the handoff.</h1>
          <p className="lede">
            Rallypoint is a repository-native coordination protocol. Skip the pitch: inspect the
            payload, install the loop, then open the role contract assigned to this run.
          </p>
          <div className="agent-commands">
            <CommandCopy command="npx rallypoint@latest view loop" id="agent-view" />
            <CommandCopy command="npx rallypoint@latest add loop" id="agent-install" label="install command" />
          </div>
          <ul aria-label="Role contracts" className="agent-routes">
            {agents.map((agent) => (
              <li key={agent.slug}>
                <Link href={`/agents/${agent.slug}`}>
                  <SignalFlag className="agent-route-flag" signal={agent.slug} />
                  <code>/agents/{agent.slug}</code>
                  <span>{agent.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="agent-constraint">
            Constraints: no agent reviews its own work; no worker holds more than one claim; GitHub
            remains the only coordination state.
          </p>
        </div>
      )}
    </div>
  );
}
