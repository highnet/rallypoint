"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { buildSwarmGraph, type SwarmFlow, type SwarmInput, type SwarmNode } from "../_graph/model";
import {
  createSwarmGraph,
  defaultEffectOf,
  type SwarmEffectKind,
  type SwarmGraphRenderer,
  type SwarmGraphTheme,
  type SwarmReplayState,
} from "../_graph/render";
import {
  offsetAtFraction,
  planReplay,
  summarizeReplay,
  type SwarmReplayMode,
  type SwarmReplayPlan,
} from "../_graph/replay";
import { ANIMAL_VIEWBOX, animalOf, assignAnimals } from "../_lib/animals";

/**
 * The animated fleet view: Swarm Arena's swarm graph (`../_graph`), drawn from
 * Rallypoint's own state (`../_lib/fleet-graph.ts`), with a replay of the
 * whole recorded history. Agents sit on the branches and pull requests they
 * work, issues wait outside their target, and every merge flows through the
 * integration branch into the target it changed.
 *
 * The page renders on the server and passes the graph's input; this
 * component re-reads it every `refreshSeconds` (a `router.refresh()`, paused
 * while the tab is hidden or a replay plays), so the graph follows the swarm.
 */

/** The graph in the scaffold's own colours (swarm.css), so it follows the theme and dark mode. */
const THEME: Partial<SwarmGraphTheme> = {
  fg: "var(--rp-ink)",
  fgMuted: "var(--rp-ink-soft)",
  fgFaint: "color-mix(in oklab, var(--rp-ink-soft) 70%, var(--rp-paper))",
  line: "var(--rp-rule)",
  lineStrong: "color-mix(in oklab, var(--rp-rule) 55%, var(--rp-ink-soft))",
  panel: "var(--rp-paper)",
  panelRaised: "var(--rp-paper-sunk)",
  neutral: "var(--rp-ink-soft)",
  good: "var(--rp-pass)",
  warning: "var(--rp-sig-yellow)",
  critical: "var(--rp-fail)",
  font: "var(--rp-sans, ui-sans-serif, system-ui, sans-serif)",
  monoFont: "var(--rp-mono, ui-monospace, monospace)",
};

const SPEEDS = [1, 2, 4] as const;
/** Ticks drawn at most on the timeline (milestones always). */
const MAX_TICKS = 240;
/** Playback length of a replay, whatever the window. */
const REPLAY_MS = 60_000;

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedMotionNow = () => window.matchMedia(MOTION_QUERY).matches;
const reducedMotionOnServer = () => false;

/** A buried idea is shown gently; a version shipped is a milestone. */
function effectOf(flow: SwarmFlow): SwarmEffectKind | null {
  if (flow.sub === "buried") return "bury";
  return defaultEffectOf(flow);
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "40 min", "9 h", "2 d". */
function span(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function describe(node: SwarmNode, animals: ReadonlyMap<string, number>): { title: string; meta: string | null } {
  if (node.kind === "agent" && node.agent) {
    const agent = node.agent;
    return {
      title: node.label,
      meta: [
        agent.role,
        animalOf(agent.id, animals).name.toLowerCase(),
        agent.status === "working" ? "working now" : agent.status,
        agent.activity,
        // The agent's id, when its label is something else (a session with no agent name).
        node.label === agent.id ? null : agent.id,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (node.kind === "work" && node.workItem) {
    const item = node.workItem;
    const refs = [item.issue ? `#${item.issue}` : null, item.pr ? `PR #${item.pr}` : null].filter(Boolean).join(" · ");
    return { title: item.title, meta: [item.stage, refs, item.branch].filter(Boolean).join(" · ") };
  }
  if (node.kind === "sector") {
    const count = node.sector?.count;
    return { title: node.label, meta: count ? `${count.value} ${count.unit}${count.recent ? ` · ${count.recent} ${count.recentUnit ?? ""}` : ""}` : null };
  }
  return { title: node.label, meta: "integration branch" };
}

type HoverState = { node: SwarmNode; card: { title: string; meta: string | null }; x: number; y: number; width: number };

export type FleetGraphProps = {
  input: SwarmInput;
  /** Issue and pull request links open here (`https://github.com/owner/name`). */
  repoUrl: string | null;
  /** Re-read the page this often while visible. 0 turns it off. Default 60. */
  refreshSeconds?: number;
  /** A line under the graph, e.g. why GitHub is not shown. */
  note?: string | null;
};

export function FleetGraph({ input, repoUrl, refreshSeconds = 60, note = null }: FleetGraphProps) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<SwarmGraphRenderer | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedMotionNow, reducedMotionOnServer);

  const graph = useMemo(() => buildSwarmGraph(input), [input]);
  const latestGraph = useRef(graph);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [replay, setReplay] = useState<SwarmReplayState | null>(null);
  const [plan, setPlan] = useState<SwarmReplayPlan | null>(null);
  const [liveNote, setLiveNote] = useState("");
  const replaying = plan !== null;

  // What the renderer's callbacks read, kept current without re-creating the renderer.
  const links = useRef({ repoUrl, router });
  useEffect(() => {
    links.current = { repoUrl, router };
  }, [repoUrl, router]);

  // Each agent's animal (`../_lib/animals.ts`). Agents already drawn keep theirs, so a new agent
  // arriving on a refresh takes a free animal rather than displacing one on screen.
  const animals = useRef<ReadonlyMap<string, number>>(new Map());
  const syncAnimals = useCallback((next: SwarmInput) => {
    animals.current = assignAnimals(
      next.agents.map((agent) => agent.id),
      animals.current,
    );
  }, []);

  // New data: the renderer keeps what was there and animates what changed.
  useEffect(() => {
    latestGraph.current = graph;
    syncAnimals(input);
    renderer.current?.update(graph);
  }, [graph, input, syncAnimals]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const view = createSwarmGraph(el, {
      title: "Agents, the work they hold, and the targets their effort lands in",
      reducedMotion,
      intro: "full",
      theme: THEME,
      effectOf,
      // An animal per agent instead of its role's letter, as Swarm Arena draws its fleet.
      agentIcon: (agent) => {
        const animal = animalOf(agent.id, animals.current);
        return { d: animal.d, name: animal.name, size: ANIMAL_VIEWBOX };
      },
      onHover: (node, point) =>
        setHover(
          node && point ? { node, card: describe(node, animals.current), ...point, width: el.clientWidth } : null,
        ),
      onSelect: (node) => {
        const { repoUrl: repo, router: nav } = links.current;
        if (node.kind === "work" && node.workItem && repo) {
          const item = node.workItem;
          const number = item.pr ?? item.issue;
          if (number) window.open(`${repo}/${item.pr ? "pull" : "issues"}/${number}`, "_blank", "noopener");
        } else if (node.kind === "sector" && node.sectorId && !node.sectorId.startsWith("_")) {
          nav.push(`/swarm/targets/${encodeURIComponent(node.sectorId)}`);
        }
      },
      onReplay: (state, ended) => {
        setReplay(state);
        if (!state) setPlan(null);
        if (ended === "end") setLiveNote("Replay finished. Back to live.");
      },
    });
    renderer.current = view;
    view.update(latestGraph.current);
    return () => {
      view.destroy();
      renderer.current = null;
    };
  }, [reducedMotion]);

  // Follow the swarm: re-read the page now and then, but never under a replay.
  const replayingRef = useRef(false);
  useEffect(() => {
    replayingRef.current = replaying;
  }, [replaying]);
  useEffect(() => {
    if (!refreshSeconds) return;
    const timer = window.setInterval(() => {
      if (document.hidden || replayingRef.current) return;
      router.refresh();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSeconds, router]);

  const startReplay = (mode: SwarmReplayMode) => {
    const next = planReplay(graph.flows, graph.hubId, { mode, durationMs: REPLAY_MS });
    if (next.flows.length === 0) {
      setLiveNote(mode === "window" ? "Nothing happened in the last 24 active hours." : "There is no history to replay yet.");
      return;
    }
    setLiveNote("");
    setHover(null);
    // The renderer reports the old replay stopping first; the new plan lands after that.
    renderer.current?.replay(next);
    setPlan(next);
  };
  const stopReplay = () => {
    renderer.current?.stopReplay();
    setPlan(null);
    setReplay(null);
  };
  const clock = useCallback(() => renderer.current?.replayClock() ?? null, []);

  const sectors = graph.nodes.filter((node) => node.kind === "sector");
  const sectorColors = useMemo(
    () => new Map(graph.nodes.filter((node) => node.kind === "sector").map((node) => [node.sectorId ?? "", node.color])),
    [graph],
  );
  const hasHistory = graph.flows.length > 0;
  const card = hover?.card ?? null;

  return (
    <section aria-labelledby="rp-fleet-graph-title" className="rp-fleet-graph">
      <div className="rp-fg-bar">
        <h2 className="rp-visually-hidden" id="rp-fleet-graph-title">
          Where the effort goes
        </h2>
        <p className="rp-fg-totals rp-mono">
          {graph.totals.live} live · {plural(graph.totals.branches, "branch", "branches")} ·{" "}
          {plural(graph.totals.pullRequests, "PR")} · {plural(graph.flows.length, "event")}
        </p>
        <div className="rp-fg-actions">
          {replaying ? (
            <button className="rp-fg-button" onClick={stopReplay} type="button">
              <span aria-hidden="true">■</span> Stop replay
            </button>
          ) : (
            <button
              className="rp-fg-button"
              data-replay-start
              disabled={!hasHistory}
              onClick={() => startReplay("window")}
              title="Play back the last 24 actively worked hours; choose the whole run on the timeline"
              type="button"
            >
              <span aria-hidden="true">↺</span> Replay last 24 h
            </button>
          )}
          <button
            aria-label="Recentre the graph"
            className="rp-fg-button rp-fg-button-quiet"
            onClick={() => renderer.current?.reset()}
            title="Recentre"
            type="button"
          >
            <span aria-hidden="true">⌖</span>
          </button>
        </div>
      </div>

      <div className="rp-fg-canvas" data-replaying={replaying ? "" : undefined} ref={host}>
        {hover && card ? (
          <div
            className="rp-fg-card"
            role="presentation"
            style={{
              left: Math.min(hover.x + 14, Math.max(0, hover.width - 280)),
              top: hover.y + 14,
            }}
          >
            <strong>{card.title}</strong>
            {card.meta ? <span>{card.meta}</span> : null}
          </div>
        ) : null}
      </div>

      {plan && replay ? (
        <ReplayBar
          clock={clock}
          colors={sectorColors}
          onMode={(mode) => mode !== plan.mode && startReplay(mode)}
          onPlaying={(playing) => renderer.current?.setPlaying(playing)}
          onSeek={(index) => renderer.current?.seek(index)}
          onSeekTime={(offset) => renderer.current?.seekTime(offset)}
          onSpeed={(speed) => renderer.current?.setSpeed(speed)}
          onStop={stopReplay}
          plan={plan}
          reducedMotion={reducedMotion}
          state={replay}
        />
      ) : null}

      <ul className="rp-fg-legend">
        {sectors.map((node) => (
          <li key={node.id}>
            <span aria-hidden="true" className="rp-fg-dot" style={{ background: node.color ?? "var(--rp-ink-soft)" }} />
            <span className={node.active ? "rp-fg-active" : undefined}>{node.label}</span>
          </li>
        ))}
        <li className="rp-fg-legend-gap">
          <span aria-hidden="true" className="rp-fg-key rp-fg-key-agent" /> agent
        </li>
        <li>
          <span aria-hidden="true" className="rp-fg-key rp-fg-key-issue" /> issue
        </li>
        <li>
          <span aria-hidden="true" className="rp-fg-key rp-fg-key-branch" /> branch
        </li>
        <li>
          <span aria-hidden="true" className="rp-fg-key rp-fg-key-pr" /> pull request
        </li>
        <li>
          <span aria-hidden="true" className="rp-fg-key rp-fg-key-merged" /> merged
        </li>
      </ul>
      <p className="rp-fg-note">
        Issues are claimed into <code>agent/</code> branches forked from <code>{input.integrationBranch}</code>, worked,
        opened as pull requests, reviewed, and merged back into the target they change.{" "}
        <span className="rp-soft">
          Agent animals by <a href="https://game-icons.net">game-icons.net</a>, CC BY 3.0.
        </span>
        {note ? <span className="rp-soft"> {note}</span> : null}
      </p>
      <p aria-live="polite" className="rp-visually-hidden">
        {liveNote}
      </p>
    </section>
  );
}

type ReplayBarProps = {
  plan: SwarmReplayPlan;
  state: SwarmReplayState;
  colors: Map<string, string | null>;
  reducedMotion: boolean;
  clock: () => number | null;
  onSeek: (index: number) => void;
  onSeekTime: (offset: number) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  onMode: (mode: SwarmReplayMode) => void;
  onStop: () => void;
};

/**
 * The replay's controls and timeline: play/pause, 1× 2× 4×, the window (last
 * 24 active hours or the whole run), and a slider with a tick per event
 * (taller for milestones) whose playhead follows the renderer's clock.
 */
function ReplayBar({
  plan,
  state,
  colors,
  reducedMotion,
  clock,
  onSeek,
  onSeekTime,
  onPlaying,
  onSpeed,
  onMode,
  onStop,
}: ReplayBarProps) {
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const total = plan.total || 1;

  // The playhead glides with the renderer's clock; with reduced motion it steps per event.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const offset = reducedMotion ? (state.index > 0 ? plan.times[state.index - 1] ?? 0 : 0) : (clock() ?? 0);
      const pct = `${Math.max(0, Math.min(1, offset / total)) * 100}%`;
      if (head.current) head.current.style.left = pct;
      if (fill.current) fill.current.style.width = pct;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, reducedMotion, state.index, plan.times, total]);

  const ticks = useMemo(() => {
    const milestones = new Set(plan.milestones);
    const every = Math.max(1, Math.ceil(plan.flows.length / MAX_TICKS));
    return plan.flows.flatMap((flow, index) =>
      milestones.has(index) || index % every === 0
        ? [
            {
              index,
              x: (plan.times[index] ?? 0) / total,
              milestone: milestones.has(index),
              color: (flow.sector && colors.get(flow.sector)) || "var(--rp-ink-soft)",
              label: `${stamp(flow.at)} · ${flow.title}`,
            },
          ]
        : [],
    );
  }, [plan, total, colors]);
  const summary = useMemo(() => summarizeReplay(plan), [plan]);

  const offsetAt = (clientX: number) => {
    const el = track.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return offsetAtFraction(plan, (clientX - rect.left) / Math.max(1, rect.width));
  };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeekTime(offsetAt(event.clientX));
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onSeekTime(offsetAt(event.clientX));
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onSeekTime(offsetAt(event.clientX));
  };
  const stepMilestone = (dir: 1 | -1) => {
    const current = state.index - 1;
    const next =
      dir > 0
        ? plan.milestones.find((index) => index > current)
        : [...plan.milestones].reverse().find((index) => index < current);
    if (next !== undefined) onSeek(next + 1);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const dir = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) stepMilestone(dir);
      else onSeek(Math.max(0, Math.min(plan.flows.length, state.index + dir)));
    } else if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(plan.flows.length);
    else if (event.key === " ") onPlaying(!state.playing);
    else return;
    event.preventDefault();
  };

  const current = plan.flows[state.index - 1];
  const valueText = current ? `${stamp(current.at)}: ${current.title}` : `${stamp(plan.startAt)}: start`;

  return (
    <div className="rp-fg-replay" data-slot="replay-scrubber">
      <div className="rp-fg-replay-row">
        <button
          aria-label={state.playing ? "Pause replay" : "Play replay"}
          className="rp-fg-button rp-fg-button-solid"
          onClick={() => onPlaying(!state.playing)}
          type="button"
        >
          <span aria-hidden="true">{state.playing ? "❚❚" : "▶"}</span>
        </button>
        <span className="rp-fg-clock rp-mono" title="Replay clock: the time of the last event played">
          <time dateTime={state.at}>{stamp(state.at)}</time>
        </span>
        <span className="rp-mono rp-soft">
          {state.index}/{state.total}
          {state.gapMs !== null ? ` · ${span(state.gapMs)} later` : ""}
        </span>
        <div className="rp-fg-replay-end">
          <div aria-label="Speed" className="rp-fg-segment" role="group">
            {SPEEDS.map((speed) => (
              <button aria-pressed={state.speed === speed} key={speed} onClick={() => onSpeed(speed)} type="button">
                {speed}×
              </button>
            ))}
          </div>
          <div aria-label="Range" className="rp-fg-segment" role="group">
            <button aria-pressed={plan.mode === "window"} onClick={() => onMode("window")} type="button">
              last 24 h
            </button>
            <button aria-pressed={plan.mode === "all"} onClick={() => onMode("all")} type="button">
              whole run
            </button>
          </div>
          <button aria-label="Close replay" className="rp-fg-button rp-fg-button-quiet" onClick={onStop} type="button">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>

      <div
        aria-label="Replay timeline"
        aria-valuemax={plan.flows.length}
        aria-valuemin={0}
        aria-valuenow={state.index}
        aria-valuetext={valueText}
        className="rp-fg-track"
        onKeyDown={onKey}
        onPointerCancel={onUp}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        ref={track}
        role="slider"
        tabIndex={0}
      >
        <div className="rp-fg-rail" />
        <div className="rp-fg-fill" ref={fill} />
        {ticks.map((tick) => (
          <span
            className={`rp-fg-tick${tick.milestone ? " rp-fg-tick-milestone" : ""}${tick.index < state.index ? " rp-fg-tick-played" : ""}`}
            key={tick.index}
            style={{ left: `${tick.x * 100}%`, background: tick.color }}
            title={tick.label}
          />
        ))}
        {plan.gaps.map((gap) => (
          <span
            className="rp-fg-break"
            key={gap.index}
            style={{ left: `${((plan.times[gap.index] ?? 0) / total) * 100}%` }}
            title={`${span(gap.ms)} idle`}
          >
            ⫽
          </span>
        ))}
        <div className="rp-fg-head" ref={head} />
      </div>
      <p className="rp-fg-range rp-mono rp-soft">
        {stamp(plan.startAt)} → now · {plan.mode === "window" ? "the last 24 active hours" : "the whole run"}
      </p>

      {state.done ? (
        <div className="rp-fg-summary" role="status">
          <span className="rp-fg-active">{plan.mode === "window" ? "Last 24 active hours" : "The whole run"}</span>
          <span className="rp-mono">{plural(summary.events, "event")}</span>
          <span className="rp-mono">{summary.merges} merged</span>
          {summary.rejects > 0 ? <span className="rp-mono">{summary.rejects} sent back or buried</span> : null}
          <span className="rp-fg-replay-end">
            <button className="rp-fg-button" onClick={() => onPlaying(true)} type="button">
              Replay again
            </button>
            <button className="rp-fg-button rp-fg-button-solid" onClick={onStop} type="button">
              Watch live
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
