"use client";

import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  GitMerge,
  GitPullRequest,
  Pause,
  Play,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { LabelChip } from "@/components/label-chip";
import { SignalFlag } from "@/components/signal-flag";
import { agents } from "@/lib/agents";
import { runIssue, stations, type Station } from "@/lib/issue-run";
import { cn } from "@/lib/utils";

const STEP_MS = 4200;
const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Clicks on the controls before React hydrates have no handler and would be
// lost — on a phone that window is seconds long, the visitor's Next does
// nothing and autoplay then starts as if they had never touched it. This runs
// as the HTML parses, queues those clicks (with the play state the visitor
// asked for), and SignalRail replays them once it is live.
const EARLY_INPUT = `(function(){var r=document.currentScript.parentNode,q=window.__railQueue=[];r.addEventListener("click",function(e){if(window.__railLive)return;var b=e.target.closest("[data-rail-control]");if(!b)return;q.push({el:b,want:b.getAttribute("aria-pressed")!=="true"});},true);})();`;

type QueuedInput = { el: HTMLElement; want: boolean };
type RailWindow = Window & { __railQueue?: QueuedInput[]; __railLive?: boolean };

function roleName(slug: Station["holder"]) {
  return agents.find((agent) => agent.slug === slug)?.name ?? slug;
}

export function SignalRail() {
  const [active, setActive] = useState(0);
  // null until the visitor touches the controls; then their choice wins.
  const [choice, setChoice] = useState<boolean | null>(null);
  const reduced = useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE).matches,
    () => true,
  );
  const playing = choice ?? !reduced;
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLElement>(null);
  const station = stations[active];

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.25,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView) return;
    const timer = window.setTimeout(
      () => setActive((index) => (index + 1) % stations.length),
      active === stations.length - 1 ? STEP_MS * 1.6 : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active, playing, inView]);

  // Layout effect: it runs in the hydration commit itself, so no click can be
  // both handled by React and queued by the early script.
  useLayoutEffect(() => {
    const railWindow = window as RailWindow;
    railWindow.__railLive = true;
    const queue = railWindow.__railQueue ?? [];
    railWindow.__railQueue = [];
    // One task per click so each replay sees the step the previous one set.
    const timers = queue.map(({ el, want }) =>
      window.setTimeout(() => {
        const isToggle = el.hasAttribute("aria-pressed");
        if (!isToggle || (el.getAttribute("aria-pressed") === "true") !== want) el.click();
      }, 0),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const go = useCallback((index: number) => {
    setChoice(false);
    setActive((index + stations.length) % stations.length);
  }, []);

  return (
    <section aria-labelledby="rail-title" className="rail" id="loop" ref={rootRef}>
      <script dangerouslySetInnerHTML={{ __html: EARLY_INPUT }} suppressHydrationWarning />
      <div className="rail-head">
        <h2 className="rail-title" id="rail-title">
          <span className="rail-title-number">#{runIssue.number}</span> {runIssue.title}
        </h2>
        <p className="rail-tag">Illustrative run · real commands</p>
        <div className="rail-controls" role="group" aria-label="Step through the run">
          <button
            aria-label="Previous step"
            data-rail-control=""
            className="btn btn-icon btn-secondary"
            onClick={() => go(active - 1)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            aria-label={playing ? "Pause the run" : "Play the run"}
            data-rail-control=""
            aria-pressed={playing}
            className="btn btn-icon btn-secondary"
            onClick={() => setChoice(!playing)}
            type="button"
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button
            aria-label="Next step"
            data-rail-control=""
            className="btn btn-icon btn-secondary"
            onClick={() => go(active + 1)}
            type="button"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <ol className="rail-track" style={{ "--progress": active / (stations.length - 1) } as React.CSSProperties}>
        {stations.map((item, index) => {
          const reached = index <= active;
          return (
            <li
              className={cn("station", reached && "is-reached", index === active && "is-active")}
              key={item.id}
            >
              <button
                aria-current={index === active ? "step" : undefined}
                data-rail-control=""
                className="station-button"
                onClick={() => go(index)}
                type="button"
              >
                <span aria-hidden="true" className="station-mast">
                  <SignalFlag className="station-flag" signal={item.holder} />
                </span>
                <span aria-hidden="true" className="station-node" />
                <span className="station-name">{item.name}</span>
                <span className="station-holder">{roleName(item.holder)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className="rail-detail">
        <div className="gh-card" key={`gh-${station.id}`}>
          <div className="gh-row">
            <span className={cn("gh-state", station.issue === "Open" ? "gh-open" : "gh-done")}>
              {station.issue === "Open" ? <CircleDot aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
              {station.issue}
            </span>
            <span className="gh-ref">Issue #{runIssue.number}</span>
            <span className="gh-labels">
              {station.issueLabels.map((label) => (
                <LabelChip key={label} label={label} />
              ))}
            </span>
          </div>
          <div className={cn("gh-row", station.pr === "None" && "is-empty")}>
            {station.pr === "None" ? (
              <span className="gh-none">No pull request yet</span>
            ) : (
              <>
                <span className={cn("gh-state", station.pr === "Open" ? "gh-open" : "gh-done")}>
                  {station.pr === "Open" ? (
                    <GitPullRequest aria-hidden="true" />
                  ) : (
                    <GitMerge aria-hidden="true" />
                  )}
                  {station.pr}
                </span>
                <span className="gh-ref">PR #{runIssue.pr}</span>
                <span className="gh-labels">
                  {station.prLabels.map((label) => (
                    <LabelChip key={label} label={label} />
                  ))}
                </span>
              </>
            )}
          </div>
          {station.ref ? (
            <p className="gh-refpath">
              <span>{station.id === "claimed" ? "ref created" : "branch"}</span>
              <code>{station.ref}</code>
            </p>
          ) : null}
        </div>
        <div className="rail-event" key={`ev-${station.id}`}>
          <p className="rail-actor">
            <SignalFlag className="rail-actor-flag" signal={station.holder} />
            <span>
              <strong>{roleName(station.holder)}</strong> <code>{station.actor}</code>
            </span>
            <span className="rail-step">
              Step {active + 1} of {stations.length}
            </span>
          </p>
          <pre className="rail-command">
            <code>{station.command}</code>
          </pre>
          <p className="rail-note">{station.note}</p>
        </div>
      </div>
    </section>
  );
}
