/**
 * The improver's cycle, one row per step, each naming the command that owns
 * it. Every step is protocol fact from `docs/AGENT_LOOP.md`, "Self-improvement".
 */
const steps = [
  {
    step: "Measure",
    command: "improvement.mjs retro",
    detail:
      "Reads merged and closed agent pull requests and the verdicts recorded on them: first-pass approval, review rounds, abandoned work, escalations, time to merge, and the notes reviewers keep repeating.",
  },
  {
    step: "Propose",
    command: "loop:improvement",
    detail:
      "One small change to one role prompt, as an ordinary pull request that names the metric it should move and a counter-metric it could harm.",
  },
  {
    step: "Gate",
    command: "improvement.mjs check",
    detail:
      "Refuses a change that touches a frozen path or arrives while the last one is still being measured. Independent review still applies.",
  },
  {
    step: "Evaluate",
    command: "improvement.mjs evaluate",
    detail:
      "Compares equal samples before and after the merge. Kept only if the target improved and no guard worsened; otherwise it is reverted.",
  },
] as const;

export function ImprovementCycle() {
  return (
    <div className="table-wrap">
      <table className="code-table">
        <caption className="sr-only">The improver’s cycle: measure, propose, gate, evaluate</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Owned by</th>
            <th scope="col">What happens</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((item) => (
            <tr key={item.step}>
              <th scope="row">{item.step}</th>
              <td data-label="Owned by">
                <code>{item.command}</code>
              </td>
              <td data-label="What happens">{item.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
