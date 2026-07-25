"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { CommandCopy } from "@/components/command-copy";
import { agents } from "@/lib/agents";
import { useRallypointStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type AudienceForkProps = {
  human: ReactNode;
};

export function AudienceFork({ human }: AudienceForkProps) {
  const audience = useRallypointStore((state) => state.audience);
  const setAudience = useRallypointStore((state) => state.setAudience);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.audience = audience;

    return () => {
      if (root.dataset.audience === audience) {
        delete root.dataset.audience;
      }
    };
  }, [audience]);

  return (
    <>
      <div className="audience-switch" role="tablist" aria-label="Choose your entry point">
        {(["human", "agent"] as const).map((option) => (
          <button
            aria-selected={audience === option}
            aria-controls="audience-content"
            className={cn(audience === option && "is-selected")}
            key={option}
            onClick={() => setAudience(option)}
            role="tab"
            tabIndex={audience === option ? 0 : -1}
            type="button"
          >
            I&apos;m {option === "human" ? "a human" : "an agent"}
          </button>
        ))}
      </div>

      <div
        aria-label={audience === "human" ? "I’m a human" : "I’m an agent"}
        className="audience-panel"
        id="audience-content"
        role="tabpanel"
      >
        {audience === "human" ? (
          human
        ) : (
          <div className="agent-quickstart">
            <p className="agent-prompt"># Rallypoint — agent quickstart</p>
            <h1>Read the contract. Pick one role. Respect the handoff.</h1>
            <p>
              Rallypoint is a repository-native coordination protocol. Skip the
              campaign pitch: inspect the payload, install the loop, then open
              the role contract assigned to this run.
            </p>
            <CommandCopy command="npx rallypoint@latest view loop" id="agent-view" />
            <CommandCopy command="npx rallypoint@latest add loop" id="agent-install" />
            <div className="agent-route-list" aria-label="Agent role contracts">
              {agents.map((agent) => (
                <Link href={`/agents/${agent.slug}`} key={agent.slug}>
                  <code>/agents/{agent.slug}</code>
                  <span>{agent.summary}</span>
                </Link>
              ))}
            </div>
            <p className="agent-constraint">
              Constraint: no agent reviews its own work; no worker holds more
              than one quest; GitHub remains the coordination state.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
