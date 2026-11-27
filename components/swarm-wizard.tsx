"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { CommandCopy } from "@/components/command-copy";
import {
  arenaExample,
  arenaPitch,
  agentSetupPrompt,
  arenaUrl,
  buildSwarmConfig,
  conductorPrompt,
  emptyWizard,
  genesisPrompt,
  measureModes,
  swarmCommands,
  swarmPrompts,
  targetId,
  targetPalette,
  type Focus,
  type MeasureMode,
  type UiShape,
  type WizardState,
} from "@/lib/swarm";
import { swarmGoalCategories } from "@/lib/swarm-goals";
import { cn } from "@/lib/utils";

const scoreExamples = [
  { kind: "Tests passed", label: "Tests passing", command: "npm run test:count --silent", unit: "tests", direction: "higher" },
  { kind: "Benchmark time", label: "p50 request time", command: "npm run bench --silent", unit: "ms", direction: "lower" },
  { kind: "Eval score", label: "Eval suite score", command: "python eval.py --json", unit: "points", direction: "higher" },
  { kind: "Proof check count", label: "Lemmas checked", command: "./scripts/count-checked.sh", unit: "lemmas", direction: "higher" },
  { kind: "Match score", label: "Rating vs the ladder", command: "npm run referee --silent", unit: "Elo", direction: "higher" },
] as const;

const checkExamples = [
  { name: "build", command: "npm run build" },
  { name: "tests", command: "npm test" },
  { name: "e2e", command: "npx playwright test" },
  { name: "a11y", command: "npm run a11y" },
];

const scoreLike =
  /\b(score|scores|elo|rating|benchmark|faster|stronger|beat|beats|win rate|accuracy|latency|throughput|ms|percent|%|leaderboard|optimi[sz]e)\b/i;

const concurrencyOptions = [1, 2, 3, 4, 6, 8];
const budgetOptions: (number | null)[] = [null, 6, 12, 24];
const focusOptions: { id: Focus; detail: string }[] = [
  { id: "balanced", detail: "Let the role order decide." },
  { id: "finish-first", detail: "Land open pull requests before new work." },
  { id: "experiments", detail: "Favour new attempts on the measure." },
  { id: "port-concepts", detail: "Try what worked on one target on the others." },
];

const uiShapes: { id: UiShape; name: string; detail: string }[] = [
  { id: "product", name: "The UI is the product", detail: "add swarm-ui writes app/swarm/** into your Next.js app." },
  { id: "dashboard", name: "A standalone dashboard", detail: "add swarm-dashboard scaffolds a Next.js app in swarm-ui/." },
  { id: "none", name: "No UI for now", detail: "GitHub and your Supabase tables only." },
];

const steps = [
  { id: "pitch", title: "Pitch", optional: false },
  { id: "goal", title: "Goal", optional: true },
  { id: "measure", title: "Referee", optional: true },
  { id: "targets", title: "Targets", optional: true },
  { id: "ui", title: "UI and words", optional: true },
  { id: "conductor", title: "Conductor", optional: true },
  { id: "setup", title: "Your setup", optional: false },
] as const;

const lastStep = steps.length - 1;

function Decide() {
  return <span className="wiz-optional">Optional · or let the genesis session decide</span>;
}

export function SwarmWizard() {
  const [state, setState] = useState<WizardState>(emptyWizard);
  const [modeChosen, setModeChosen] = useState(false);
  const [category, setCategory] = useState(swarmGoalCategories[0].id);
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState(0);
  const [pitchError, setPitchError] = useState(false);
  const pitchRef = useRef<HTMLTextAreaElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const navigated = useRef(false);
  const base = useId();
  const pitchReady = state.pitch.trim().length > 0;

  const go = (next: number) => {
    if (next > 0 && !pitchReady) {
      setPitchError(true);
      setStep(0);
      pitchRef.current?.focus();
      return;
    }
    navigated.current = true;
    setStep(Math.max(0, Math.min(lastStep, next)));
  };

  // Move focus to the new step's heading after the user navigates, so
  // keyboard and screen-reader users land where the content changed.
  useEffect(() => {
    if (!navigated.current) return;
    const heading = stepRef.current?.querySelector<HTMLElement>("[data-step-heading]");
    heading?.focus({ preventScroll: true });
    stepRef.current?.closest("form")?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [step]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const suggestedMode: MeasureMode = scoreLike.test(state.pitch) ? "score" : "checks";
  const mode = modeChosen ? state.measureMode : suggestedMode;
  const effective = useMemo(() => ({ ...state, measureMode: mode }), [state, mode]);

  const applyExample = () => {
    setState(arenaExample);
    setModeChosen(true);
    setPitchError(false);
    setNotice("Filled every step with the Swarm Arena example. Step through it, or jump to your setup.");
  };

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("example") !== "arena") return;
    const timer = window.setTimeout(() => {
      setState(arenaExample);
      setModeChosen(true);
      setStep(lastStep);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const pickGoal = (goal: string) => {
    setState((current) => ({ ...current, pitch: goal }));
    setPitchError(false);
    setNotice(`Pitch set to: ${goal}`);
    pitchRef.current?.focus();
  };

  const config = useMemo(() => JSON.stringify(buildSwarmConfig(effective), null, 2), [effective]);
  const conductor = conductorPrompt(effective);
  const genesis = genesisPrompt(state.pitch, config);
  const agentSetup = agentSetupPrompt(state.pitch, config, state.uiShape);
  const firstTarget = state.targets.find((t) => t.name.trim());
  const prompts = swarmPrompts(firstTarget ? firstTarget.id?.trim() || targetId(firstTarget.name) : undefined);
  const activeCategory = swarmGoalCategories.find((c) => c.id === category) ?? swarmGoalCategories[0];

  const updateTarget = (index: number, patch: Partial<WizardState["targets"][number]>) =>
    setState((current) => ({
      ...current,
      targets: current.targets.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  const updateCheck = (index: number, patch: Partial<WizardState["checks"][number]>) =>
    setState((current) => ({
      ...current,
      checks: current.checks.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));

  const commands: { title: string; command?: string; shell?: boolean; detail?: string }[] = [
    { title: "Install the loop, if it is not there yet", command: swarmCommands.addLoop },
    { title: "Bring GitHub up to date for the loop", command: swarmCommands.init },
    { title: "Install Swarm", command: swarmCommands.addSwarm },
    ...(state.uiShape === "product"
      ? [{ title: "Add the swarm UI to your app", command: swarmCommands.addUi }]
      : state.uiShape === "dashboard"
        ? [{ title: "Add the standalone dashboard", command: swarmCommands.addDashboard }]
        : []),
    { title: "Apply the schema", detail: "In your Supabase SQL editor, run .rallypoint/swarm/schema.sql." },
    {
      title: "Connect memory and set the secret",
      command: swarmCommands.connect,
      detail: "Prompts for the keys and the swarm secret without echoing them, sets the secret, and writes gitignored env files for agents and the dashboard.",
    },
    { title: "Check everything", command: swarmCommands.doctor },
    {
      title: "Run genesis: paste this into a coding agent on the repository",
      command: genesis,
      shell: false,
      detail:
        "One prompt: it interviews you (interview-me) until you confirm a brief, initializes Impeccable for PRODUCT.md and DESIGN.md, writes your swarm.json, decides what you left open, and opens one pull request. Review and merge it like any other.",
    },
    { title: "Create target labels and store the goal", command: swarmCommands.swarmInit },
    { title: "Start one session by hand", command: swarmCommands.agentPrompt, shell: false },
  ];

  const allCommands = commands
    .map((item, index) => {
      const head = `# ${index + 1}. ${item.title}`;
      const body = item.command
        ? item.shell === false
          ? item.command
              .split("\n")
              .map((line) => (line ? `#   ${line}` : "#"))
              .join("\n")
          : item.command
        : `#   ${item.detail ?? ""}`;
      return `${head}\n${body}`;
    })
    .join("\n\n");

  const uiShapeName = uiShapes.find((shape) => shape.id === state.uiShape)?.name ?? state.uiShape;
  const namedTargets = state.targets.filter((target) => target.name.trim());
  const summary: { label: string; value: React.ReactNode; step: number }[] = [
    { label: "Pitch", value: state.pitch.trim() || "—", step: 0 },
    { label: "Goal", value: state.title.trim() || "Genesis decides", step: 1 },
    {
      label: "Referee",
      value: `${measureModes.find((m) => m.id === mode)?.name ?? mode}${modeChosen ? "" : " (suggested)"}`,
      step: 2,
    },
    {
      label: "Targets",
      value: namedTargets.length ? (
        <span className="wiz-summary-targets">
          {namedTargets.map((target) => (
            <span key={target.name}>
              <span aria-hidden="true" className="wiz-swatch" style={{ background: target.color }} />
              {target.name}
            </span>
          ))}
        </span>
      ) : (
        "Genesis decides"
      ),
      step: 3,
    },
    { label: "UI", value: `${uiShapeName} · ${state.visibility}`, step: 4 },
    {
      label: "Conductor",
      value: `${state.concurrency} at once · ${state.budget === null ? "unbounded" : `${state.budget} sessions`} · ${state.focus}`,
      step: 5,
    },
  ];

  return (
    <form
      className="wizard"
      onSubmit={(event) => {
        event.preventDefault();
        if (step < lastStep) go(step + 1);
      }}
    >
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      <nav aria-label="Wizard steps" className="wiz-stepper">
        <ol>
          {steps.map((item, index) => {
            const state_ = index === step ? "current" : index < step ? "done" : "todo";
            return (
              <li className={`is-${state_}`} key={item.id}>
                <button
                  aria-current={index === step ? "step" : undefined}
                  className="wiz-stepper-button"
                  disabled={index > 0 && !pitchReady}
                  onClick={() => go(index)}
                  type="button"
                >
                  <span aria-hidden="true" className="wiz-stepper-index">
                    {state_ === "done" ? <Check /> : index + 1}
                  </span>
                  <span className="wiz-stepper-name">
                    {item.title}
                    <span className="sr-only">
                      {state_ === "done" ? " (visited)" : ""}
                      {item.optional ? " (optional)" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div
          aria-label="Wizard progress"
          aria-valuemax={steps.length}
          aria-valuemin={1}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${steps.length}: ${steps[step].title}`}
          className="wiz-progress"
          role="progressbar"
        >
          <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <p className="wiz-step-count">
          Step {step + 1} of {steps.length} · <strong>{steps[step].title}</strong>
          {steps[step].optional ? <span className="wiz-optional"> · optional</span> : null}
        </p>
      </nav>

      <div className="wiz-stage" ref={stepRef}>

      {step === 0 ? (
      <fieldset className="wiz-step wiz-step-primary">
        <legend data-step-heading tabIndex={-1}>
          <span className="step-index">1</span> Describe your swarm in a sentence or two
        </legend>
        <div className="wiz-example">
          <p className="wiz-example-label">Worked example</p>
          <blockquote>{arenaPitch}</blockquote>
          <p className="tier-links">
            <a className="text-link" href={arenaUrl} rel="noreferrer" target="_blank">
              This pitch became Swarm Arena <ArrowUpRight aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <button className="btn btn-secondary wiz-btn" onClick={applyExample} type="button">
              Use this example
            </button>
          </p>
        </div>
        <label className="wiz-label" htmlFor={`${base}-pitch`}>
          Your pitch
        </label>
        <textarea
          aria-describedby={pitchError ? `${base}-pitch-error` : undefined}
          aria-invalid={pitchError && !pitchReady ? true : undefined}
          className="wiz-input wiz-textarea"
          id={`${base}-pitch`}
          onChange={(event) => {
            set("pitch", event.target.value);
            if (event.target.value.trim()) setPitchError(false);
          }}
          placeholder="What should the swarm build or discover, and what does better look like?"
          ref={pitchRef}
          rows={3}
          value={state.pitch}
        />
        {pitchError && !pitchReady ? (
          <p className="wiz-error" id={`${base}-pitch-error`} role="alert">
            Write a sentence or two, or pick a goal from the gallery below, to continue.
          </p>
        ) : null}

        <details className="wiz-gallery">
          <summary>Need inspiration? 100 goals in 10 categories</summary>
          <p className="wiz-hint">
            Inspiration only. These are not verified recipes, and nothing here claims a swarm has done
            them. Picking one fills your pitch; edit it or write your own.
          </p>
          <label className="wiz-label" htmlFor={`${base}-category`}>
            Category
          </label>
          <select
            className="wiz-input"
            id={`${base}-category`}
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            {swarmGoalCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}. {c.title}
              </option>
            ))}
          </select>
          <p className="wiz-category-sub">{activeCategory.subtitle}</p>
          <ul aria-label={`${activeCategory.title} goals`} className="wiz-goals">
            {activeCategory.goals.map((goal) => (
              <li key={goal}>
                <button
                  aria-pressed={state.pitch === goal}
                  className={cn("wiz-goal", state.pitch === goal && "is-selected")}
                  onClick={() => pickGoal(goal)}
                  type="button"
                >
                  {goal}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <p className="wiz-divider">
          Everything after the pitch is optional. Skip any step and genesis fills it from your pitch.
        </p>
      </fieldset>
      ) : null}

      {step === 1 ? (
      <fieldset className="wiz-step">
        <legend data-step-heading tabIndex={-1}>
          <span className="step-index">2</span> Your goal <Decide />
        </legend>
        <div className="wiz-grid">
          <div>
            <label className="wiz-label" htmlFor={`${base}-title`}>
              Title
            </label>
            <input
              className="wiz-input"
              id={`${base}-title`}
              onChange={(event) => set("title", event.target.value)}
              value={state.title}
            />
          </div>
          <div className="wiz-span">
            <label className="wiz-label" htmlFor={`${base}-statement`}>
              Statement: what done, or better, looks like
            </label>
            <textarea
              className="wiz-input wiz-textarea"
              id={`${base}-statement`}
              onChange={(event) => set("statement", event.target.value)}
              rows={3}
              value={state.statement}
            />
          </div>
        </div>
      </fieldset>
      ) : null}

      {step === 2 ? (
      <fieldset className="wiz-step">
        <legend data-step-heading tabIndex={-1}>
          <span className="step-index">3</span> How the referee judges a change <Decide />
        </legend>
        <div className="wiz-radios" role="radiogroup" aria-label="Measure mode">
          {measureModes.map((m) => (
            <label className={cn("wiz-radio", mode === m.id && "is-selected")} key={m.id}>
              <input
                checked={mode === m.id}
                name={`${base}-mode`}
                onChange={() => {
                  set("measureMode", m.id);
                  setModeChosen(true);
                }}
                type="radio"
                value={m.id}
              />
              <span>
                <span className="wiz-radio-name">
                  {m.name}
                  {!modeChosen && suggestedMode === m.id ? <span className="wiz-tag">suggested</span> : null}
                </span>
                <span className="wiz-radio-detail">{m.gate}</span>
                <span className="wiz-radio-detail">{m.fits}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="wiz-grid">
          <div className="wiz-span">
            <label className="wiz-label" htmlFor={`${base}-mlabel`}>
              Measure label
            </label>
            <input
              className="wiz-input"
              id={`${base}-mlabel`}
              onChange={(event) => set("measureLabel", event.target.value)}
              placeholder={mode === "score" ? "e.g. Elo vs the ladder" : "e.g. Release checks"}
              value={state.measureLabel}
            />
          </div>
        </div>

        {mode === "score" ? (
          <div className="wiz-mode-body">
            <div className="wiz-grid">
              <div className="wiz-span">
                <label className="wiz-label" htmlFor={`${base}-command`}>
                  Referee command
                </label>
                <input
                  aria-describedby={`${base}-command-hint`}
                  className="wiz-input wiz-mono"
                  id={`${base}-command`}
                  onChange={(event) => set("command", event.target.value)}
                  placeholder="npm run referee --silent"
                  spellCheck={false}
                  value={state.command}
                />
                <p className="wiz-hint" id={`${base}-command-hint`}>
                  Must print a number on its last stdout line, or <code>{'{"score": n}'}</code>. It runs on
                  your pull request and on the integration branch.
                </p>
              </div>
              <div>
                <span className="wiz-label" id={`${base}-direction`}>
                  Better is
                </span>
                <div aria-labelledby={`${base}-direction`} className="wiz-seg" role="radiogroup">
                  {(["higher", "lower"] as const).map((d) => (
                    <label className={cn(state.direction === d && "is-selected")} key={d}>
                      <input
                        checked={state.direction === d}
                        name={`${base}-dir`}
                        onChange={() => set("direction", d)}
                        type="radio"
                        value={d}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="wiz-label" htmlFor={`${base}-margin`}>
                  Margin to beat
                </label>
                <input
                  className="wiz-input"
                  id={`${base}-margin`}
                  inputMode="decimal"
                  onChange={(event) => set("margin", event.target.value)}
                  placeholder="0"
                  value={state.margin}
                />
              </div>
              <div>
                <label className="wiz-label" htmlFor={`${base}-unit`}>
                  Unit
                </label>
                <input
                  className="wiz-input"
                  id={`${base}-unit`}
                  onChange={(event) => set("unit", event.target.value)}
                  placeholder="ms, tests, Elo…"
                  value={state.unit}
                />
              </div>
            </div>
            <p className="wiz-sub">Examples by kind. You define the real command.</p>
            <div className="table-wrap">
              <table className="code-table wiz-examples">
                <caption className="sr-only">Example score commands by kind</caption>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Command</th>
                    <th scope="col">Unit</th>
                    <th scope="col">Better</th>
                    <th scope="col">
                      <span className="sr-only">Use</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scoreExamples.map((example) => (
                    <tr key={example.kind}>
                      <th scope="row">{example.kind}</th>
                      <td data-label="Command">
                        <code>{example.command}</code>
                      </td>
                      <td data-label="Unit">{example.unit}</td>
                      <td data-label="Better">{example.direction}</td>
                      <td className="role-open">
                        <button
                          className="btn btn-secondary wiz-btn"
                          onClick={() => {
                            setState((current) => ({
                              ...current,
                              command: example.command,
                              unit: example.unit,
                              direction: example.direction,
                              measureLabel: current.measureLabel || example.label,
                            }));
                            setNotice(`Filled the measure with the ${example.kind} example.`);
                          }}
                          type="button"
                        >
                          Use<span className="sr-only"> {example.kind} example</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {mode === "checks" ? (
          <div className="wiz-mode-body">
            <p className="wiz-hint">Every command must exit 0 for a change to pass. There is no number.</p>
            {state.checks.length ? (
              <ul className="wiz-rows" aria-label="Checks">
                {state.checks.map((check, index) => (
                  <li className="wiz-row" key={index}>
                    <div>
                      <label className="wiz-label" htmlFor={`${base}-check-name-${index}`}>
                        Check name
                      </label>
                      <input
                        className="wiz-input"
                        id={`${base}-check-name-${index}`}
                        onChange={(event) => updateCheck(index, { name: event.target.value })}
                        value={check.name}
                      />
                    </div>
                    <div className="wiz-grow">
                      <label className="wiz-label" htmlFor={`${base}-check-cmd-${index}`}>
                        Command
                      </label>
                      <input
                        className="wiz-input wiz-mono"
                        id={`${base}-check-cmd-${index}`}
                        onChange={(event) => updateCheck(index, { command: event.target.value })}
                        spellCheck={false}
                        value={check.command}
                      />
                    </div>
                    <button
                      aria-label={`Remove check ${check.name || index + 1}`}
                      className="btn btn-icon btn-quiet wiz-remove"
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          checks: current.checks.filter((_, i) => i !== index),
                        }))
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="wiz-actions">
              <button
                className="btn btn-secondary wiz-btn"
                onClick={() => set("checks", [...state.checks, { name: "", command: "" }])}
                type="button"
              >
                <Plus aria-hidden="true" /> Add a check
              </button>
              {checkExamples
                .filter((example) => !state.checks.some((c) => c.name === example.name))
                .map((example) => (
                  <button
                    className="btn btn-quiet wiz-btn"
                    key={example.name}
                    onClick={() => set("checks", [...state.checks, example])}
                    type="button"
                  >
                    <Plus aria-hidden="true" /> {example.name}
                    <span className="sr-only">: {example.command}</span>
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {mode === "review" ? (
          <p className="wiz-hint wiz-mode-body">
            No referee command. The independent reviewer’s verdict against each issue’s acceptance
            criteria is the gate, and progress is shown as delivery: merged against open issues.
          </p>
        ) : null}
      </fieldset>
      ) : null}

      {step === 3 ? (
      <fieldset className="wiz-step">
        <legend data-step-heading tabIndex={-1}>
          <span className="step-index">4</span> Targets <Decide />
        </legend>
        <p className="wiz-hint">
          Sub-areas the swarm works on in parallel, such as <code>chess</code> and <code>go9</code>. Each
          becomes a <code>target:&lt;id&gt;</code> label. The colour is always shown with the name.
        </p>
        {state.targets.length ? (
          <ul className="wiz-rows" aria-label="Targets">
            {state.targets.map((target, index) => {
              const swatch = targetPalette.find((p) => p.hex === target.color);
              return (
                <li className="wiz-row wiz-target" key={index}>
                  <div>
                    <label className="wiz-label" htmlFor={`${base}-t-name-${index}`}>
                      Name
                    </label>
                    <input
                      className="wiz-input"
                      id={`${base}-t-name-${index}`}
                      onChange={(event) => updateTarget(index, { name: event.target.value })}
                      value={target.name}
                    />
                    {target.name.trim() ? (
                      <p className="wiz-hint">
                        id <code>{target.id?.trim() || targetId(target.name)}</code>
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="wiz-label" htmlFor={`${base}-t-color-${index}`}>
                      Colour
                    </label>
                    <span className="wiz-color">
                      <span aria-hidden="true" className="wiz-swatch" style={{ background: target.color }} />
                      <select
                        className="wiz-input"
                        id={`${base}-t-color-${index}`}
                        onChange={(event) => updateTarget(index, { color: event.target.value })}
                        value={target.color}
                      >
                        {targetPalette.map((p) => (
                          <option key={p.hex} value={p.hex}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className="sr-only">{swatch?.name}</span>
                  </div>
                  <div className="wiz-grow">
                    <label className="wiz-label" htmlFor={`${base}-t-desc-${index}`}>
                      Description
                    </label>
                    <input
                      className="wiz-input"
                      id={`${base}-t-desc-${index}`}
                      onChange={(event) => updateTarget(index, { description: event.target.value })}
                      value={target.description}
                    />
                  </div>
                  <button
                    aria-label={`Remove target ${target.name || index + 1}`}
                    className="btn btn-icon btn-quiet wiz-remove"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        targets: current.targets.filter((_, i) => i !== index),
                      }))
                    }
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="wiz-actions">
          <button
            className="btn btn-secondary wiz-btn"
            onClick={() =>
              set("targets", [
                ...state.targets,
                {
                  name: "",
                  description: "",
                  color: targetPalette[state.targets.length % targetPalette.length].hex,
                },
              ])
            }
            type="button"
          >
            <Plus aria-hidden="true" /> Add a target
          </button>
        </div>
      </fieldset>
      ) : null}

      {step === 4 ? (
      <fieldset className="wiz-step">
        <legend data-step-heading tabIndex={-1}>
          <span className="step-index">5</span> The swarm UI and its words <Decide />
        </legend>
        <div className="wiz-radios" role="radiogroup" aria-label="UI shape">
          {uiShapes.map((shape) => (
            <label className={cn("wiz-radio", state.uiShape === shape.id && "is-selected")} key={shape.id}>
              <input
                checked={state.uiShape === shape.id}
                name={`${base}-ui`}
                onChange={() => set("uiShape", shape.id)}
                type="radio"
                value={shape.id}
              />
              <span>
                <span className="wiz-radio-name">{shape.name}</span>
                <span className="wiz-radio-detail">{shape.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="wiz-grid">
          <div>
            <span className="wiz-label" id={`${base}-vis`}>
              Visibility
            </span>
            <div aria-labelledby={`${base}-vis`} className="wiz-seg" role="radiogroup">
              {(["public", "private"] as const).map((v) => (
                <label className={cn(state.visibility === v && "is-selected")} key={v}>
                  <input
                    checked={state.visibility === v}
                    name={`${base}-visibility`}
                    onChange={() => set("visibility", v)}
                    type="radio"
                    value={v}
                  />
                  {v === "public" ? "public, read-only" : "private (Supabase Auth)"}
                </label>
              ))}
            </div>
          </div>
          <div className="wiz-check">
            <input
              checked={state.uiShape !== "none" && state.includeUiTarget}
              disabled={state.uiShape === "none"}
              id={`${base}-uitarget`}
              onChange={(event) => set("includeUiTarget", event.target.checked)}
              type="checkbox"
            />
            <label htmlFor={`${base}-uitarget`}>
              Also let the swarm build the UI (adds a <code>ui</code> target with starter issues)
            </label>
          </div>
          <div>
            <label className="wiz-label" htmlFor={`${base}-pname`}>
              Project name
            </label>
            <input
              className="wiz-input"
              id={`${base}-pname`}
              onChange={(event) => set("projectName", event.target.value)}
              value={state.projectName}
            />
          </div>
          <div>
            <label className="wiz-label" htmlFor={`${base}-tagline`}>
              Tagline
            </label>
            <input
              className="wiz-input"
              id={`${base}-tagline`}
              onChange={(event) => set("tagline", event.target.value)}
              value={state.tagline}
            />
          </div>
        </div>
        <p className="wiz-sub">What your swarm calls things</p>
        <div className="wiz-grid wiz-grid-3">
          {(
            [
              ["vocabShipped", "A change that ships", "shipped"],
              ["vocabBuried", "An idea that is dropped", "buried"],
              ["vocabVersion", "A shipped version", "version"],
            ] as const
          ).map(([key, label, fallback]) => (
            <div key={key}>
              <label className="wiz-label" htmlFor={`${base}-${key}`}>
                {label}
              </label>
              <input
                className="wiz-input"
                id={`${base}-${key}`}
                onChange={(event) => set(key, event.target.value)}
                placeholder={fallback}
                value={state[key]}
              />
            </div>
          ))}
        </div>
      </fieldset>
      ) : null}

      {step === 5 ? (
      <fieldset className="wiz-step">
        <legend data-step-heading tabIndex={-1}>
          <span className="step-index">6</span> The conductor <Decide />
        </legend>
        <div className="wiz-grid wiz-grid-3">
          <div>
            <label className="wiz-label" htmlFor={`${base}-concurrency`}>
              Sessions at once
            </label>
            <select
              className="wiz-input"
              id={`${base}-concurrency`}
              onChange={(event) => set("concurrency", Number(event.target.value))}
              value={state.concurrency}
            >
              {concurrencyOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="wiz-label" htmlFor={`${base}-budget`}>
              Budget
            </label>
            <select
              className="wiz-input"
              id={`${base}-budget`}
              onChange={(event) => set("budget", event.target.value === "none" ? null : Number(event.target.value))}
              value={state.budget === null ? "none" : String(state.budget)}
            >
              {budgetOptions.map((b) => (
                <option key={String(b)} value={b === null ? "none" : String(b)}>
                  {b === null ? "Unbounded" : `${b} sessions`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="wiz-label" htmlFor={`${base}-focus`}>
              Focus
            </label>
            <select
              aria-describedby={`${base}-focus-hint`}
              className="wiz-input"
              id={`${base}-focus`}
              onChange={(event) => set("focus", event.target.value as Focus)}
              value={state.focus}
            >
              {focusOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}
                </option>
              ))}
            </select>
            <p className="wiz-hint" id={`${base}-focus-hint`}>
              {focusOptions.find((f) => f.id === state.focus)?.detail}
            </p>
          </div>
        </div>
      </fieldset>
      ) : null}

      {step === lastStep ? (
      <section aria-labelledby={`${base}-out`} className="wiz-output" id="output">
        <h2 data-step-heading id={`${base}-out`} tabIndex={-1}>
          Your setup
        </h2>
        <dl className="wiz-summary">
          {summary.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
              <dd className="wiz-summary-edit">
                <button className="btn btn-quiet wiz-btn" onClick={() => go(row.step)} type="button">
                  <Pencil aria-hidden="true" /> Edit<span className="sr-only"> {row.label.toLowerCase()}</span>
                </button>
              </dd>
            </div>
          ))}
        </dl>
        <p className="wiz-hint">
          Generated in your browser as you type. Nothing on this page is sent anywhere.
        </p>

        <div className="wiz-out-block wiz-out-agentic">
          <p className="wiz-out-kicker">Fastest · agentic</p>
          <h3>Let an agent do the whole setup</h3>
          <p className="install-detail">
            One prompt for a coding agent on your repository. It installs the loop and Swarm, writes your{" "}
            <code>swarm.json</code>, runs <code>doctor</code>, then genesis: it interviews you with
            interview-me until you confirm a brief, initializes Impeccable for <code>PRODUCT.md</code> and{" "}
            <code>DESIGN.md</code>, and opens one pull request. Otherwise it stops only for Supabase and the
            secret, and never merges its own work.
          </p>
          <CommandCopy className="command-block command-json command-tall" command={agentSetup} id="wiz-agentic" label="agentic setup prompt" shell={false} />
        </div>

        <div className="wiz-out-block">
          <div className="wiz-out-head">
            <div>
              <p className="wiz-out-kicker">Or by hand</p>
              <h3>Commands, in order</h3>
            </div>
            <CommandCopy
              className="wiz-copy-all"
              command={allCommands}
              id="wiz-copy-all"
              label="all commands, as one annotated script"
              shell={false}
            />
          </div>
          <ol className="setup-steps wiz-sequence">
            {commands.map((step, index) => (
              <li key={step.title}>
                <p className="step-title">{step.title}</p>
                {step.command ? (
                  <CommandCopy
                    className={
                      step.command.includes("\n")
                        ? step.command.split("\n").length > 12
                          ? "command-block command-json command-tall"
                          : "command-block"
                        : undefined
                    }
                    command={step.command}
                    id={`wiz-cmd-${index}`}
                    label={step.title.toLowerCase()}
                    shell={step.shell ?? true}
                  />
                ) : null}
                {step.detail ? <p className="install-detail">{step.detail}</p> : null}
              </li>
            ))}
          </ol>
        </div>

        <details className="wiz-out-block wiz-config-peek">
          <summary>
            See the <code>.rallypoint/swarm.json</code> inside these prompts
          </summary>
          <CommandCopy className="command-block command-json" command={config} id="wiz-config" label="swarm.json" shell={false} />
        </details>

        <div className="wiz-out-block">
          <p className="wiz-out-kicker">After genesis merges</p>
          <h3>Prompts to keep it running</h3>
          <div className="wiz-prompt">
            <p className="step-title">Leave it running: the conductor</p>
            <p className="install-detail">
              The prompt below is for Claude Code with remote session tools. A copyable Codex conductor
              command requires the native Codex skills from{" "}
              <a href="https://github.com/highnet/rallypoint/issues/93">Rallypoint #93</a>.
              Stop the conductor to stop the swarm.
            </p>
            <CommandCopy className="command-block" command={conductor} id="wiz-conductor" label="Claude Code conductor prompt" shell={false} />
          </div>
          {prompts.map((item) => (
            <div className="wiz-prompt" key={item.id}>
              <p className="step-title">{item.title}</p>
              <p className="install-detail">{item.when}</p>
              <CommandCopy command={item.prompt} id={`wiz-prompt-${item.id}`} label={`${item.title.toLowerCase()} prompt`} shell={false} />
            </div>
          ))}
        </div>
      </section>
      ) : null}
      </div>

      <div className="wiz-nav">
        {step > 0 ? (
          <button className="btn btn-secondary wiz-nav-back" onClick={() => go(step - 1)} type="button">
            <ArrowLeft aria-hidden="true" /> Back
          </button>
        ) : (
          <span />
        )}
        <div className="wiz-nav-forward">
          {step === 0 ? (
            <button className="btn btn-quiet wiz-btn" onClick={() => go(lastStep)} type="button">
              Skip the rest: let genesis decide
            </button>
          ) : null}
          {steps[step].optional ? (
            <button className="btn btn-quiet wiz-btn" onClick={() => go(lastStep)} type="button">
              Jump to your setup
            </button>
          ) : null}
          {step < lastStep ? (
            <button className="btn btn-primary wiz-nav-next" type="submit">
              Next: {steps[step + 1].title} <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <button className="btn btn-secondary wiz-nav-next" onClick={() => go(0)} type="button">
              Back to the pitch
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
