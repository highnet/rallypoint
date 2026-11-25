import { tierComparison } from "@/lib/swarm";

/** Vanilla vs Swarm, as a real table: one row per aspect, from the brief. */
export function SwarmCompare() {
  return (
    <div className="table-wrap">
      <table className="code-table tier-table">
        <caption className="sr-only">
          What Rallypoint gives on its own, and what Rallypoint Swarm adds, aspect by aspect
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Aspect</span>
            </th>
            <th scope="col">Rallypoint</th>
            <th scope="col">Rallypoint Swarm</th>
          </tr>
        </thead>
        <tbody>
          {tierComparison.map((row) => (
            <tr key={row.aspect}>
              <th scope="row">{row.aspect}</th>
              <td data-label="Rallypoint">{row.vanilla}</td>
              <td data-label="Rallypoint Swarm">{row.swarm}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
