/**
 * Rallypoint Swarm as one transit schematic: the work line runs on GitHub
 * (issue → claim → pull request → referee → review → merge), the memory line
 * runs in the project's own Supabase, and the learning loop carries memory
 * back into the next issue and the tunable skills. The judges stay frozen.
 * Every station name is a real GitHub noun or a `rallypoint swarm` command.
 */
const work = [
  { x: 100, name: "Issue", code: "swarm plan", note: "planner opens it" },
  { x: 267, name: "Claim", code: "claim.mjs", note: "one per issue" },
  { x: 433, name: "Pull request", code: "Closes #n", note: "one per claim" },
  { x: 767, name: "Referee", code: "swarm referee", note: "exit 0 passes" },
  { x: 933, name: "Review", code: "head SHA", note: "never own work" },
  { x: 1100, name: "Merge", code: "swarm ship", note: "merger only" },
];

const memory = [
  { x: 100, name: "retros" },
  { x: 267, name: "sessions" },
  { x: 433, name: "progress" },
  { x: 600, name: "messages" },
  { x: 767, name: "results" },
  { x: 933, name: "buried ideas" },
  { x: 1100, name: "concepts" },
];

const links = [
  { x: 267, label: "prepare" },
  { x: 433, label: "log" },
  { x: 600, label: "say · inbox" },
];

export function SwarmMechanism() {
  return (
    <figure className="mech">
      <svg
        aria-labelledby="mech-title mech-desc"
        className="mech-svg mech-wide"
        role="img"
        viewBox="0 0 1200 670"
      >
        <title id="mech-title">How Rallypoint Swarm works</title>
        <desc id="mech-desc">
          GitHub owns the work: an issue is claimed, delivered as one pull request, measured by the
          referee, reviewed independently and merged. A change that loses at the referee is buried with
          its numbers. Supabase owns the memory: sessions, progress, retros, messages, results, buried
          ideas and concepts. The learning loop feeds memory back into the next issues and into the
          tunable skills; the referee, review, merge and scripts are frozen.
        </desc>

        <text className="mech-head" x="40" y="44">
          GitHub owns the work
        </text>

        {/* memory panel first so lines draw over it */}
        <rect className="mech-panel" height="200" rx="6" width="1110" x="60" y="300" />
        <text className="mech-head" x="80" y="484">
          Your Supabase owns the memory
        </text>
        <text className="mech-note" textAnchor="end" x="1150" y="484">
          swarm_* tables · read-only to the browser
        </text>

        {/* work → memory links */}
        {links.map((link) => (
          <g key={link.x}>
            <path className="mech-link" d={`M${link.x} 222 V384`} />
            <text className="mech-note" x={link.x + 10} y="268">
              {link.label}
            </text>
          </g>
        ))}
        <path className="mech-link" d="M767 222 V384" />
        <text className="mech-note" x="777" y="340">
          every run
        </text>
        <path className="mech-link" d="M1100 222 V384" />
        <text className="mech-note" textAnchor="end" x="1090" y="262">
          ship · trial
        </text>

        {/* a loss at the referee is buried, with its numbers */}
        <path className="mech-loss" d="M767 236 L803 272 H933 V384" />
        <text className="mech-loss-text" x="815" y="262">
          loses: swarm bury
        </text>

        {/* work line */}
        <path className="mech-line mech-issue" d="M100 130 H433" />
        <path className="mech-line mech-pr" d="M433 130 H1100" />

        {/* memory line */}
        <path className="mech-line mech-mem" d="M100 400 H1100" />

        {/* learning loop back into the work */}
        <path className="mech-loop" d="M600 500 V566 H24 V130 H86" />
        <text className="mech-label" x="70" y="600">
          Learning loop
        </text>
        <text className="mech-note" x="70" y="628">
          swarm brief → swarm plan opens the next issues;
        </text>
        <text className="mech-note" x="70" y="652">
          the improver tunes one skill or role prompt.
        </text>

        {/* frozen */}
        <path className="mech-stop" d="M820 528 V626" />
        <text className="mech-label" x="842" y="562">
          Frozen to the improver
        </text>
        <text className="mech-note" x="842" y="592">
          referee · review · merge · scripts
        </text>

        {work.map((station, index) => (
          <g key={station.name}>
            <circle
              className={index === work.length - 1 ? "mech-station mech-end" : "mech-station"}
              cx={station.x}
              cy="130"
              r={index === work.length - 1 ? 16 : 14}
            />
            <text className="mech-label" textAnchor="middle" x={station.x} y="96">
              {station.name}
            </text>
            <text className="mech-mono" textAnchor="middle" x={station.x} y="178">
              {station.code}
            </text>
            <text className="mech-note" textAnchor="middle" x={station.x} y="204">
              {station.note}
            </text>
          </g>
        ))}

        {memory.map((stop) => (
          <g key={stop.name}>
            <circle className="mech-station" cx={stop.x} cy="400" r="12" />
            <text className="mech-small" textAnchor="middle" x={stop.x} y="440">
              {stop.name}
            </text>
          </g>
        ))}
      </svg>

      {/* Tall schematic: phones */}
      <svg aria-labelledby="mech-title-tall" className="mech-svg mech-tall" role="img" viewBox="0 0 400 1170">
        <title id="mech-title-tall">
          How Rallypoint Swarm works: GitHub owns the work, your Supabase owns the memory, and a
          learning loop feeds memory back into the work while the judges stay frozen.
        </title>
        <text className="mech-head" x="24" y="36">
          GitHub owns the work
        </text>
        <path className="mech-line mech-issue" d="M56 80 V280" />
        <path className="mech-line mech-pr" d="M56 280 V580" />
        {work.map((station, index) => {
          const y = 80 + index * 100;
          return (
            <g key={station.name}>
              <circle
                className={index === work.length - 1 ? "mech-station mech-end" : "mech-station"}
                cx="56"
                cy={y}
                r={index === work.length - 1 ? 16 : 14}
              />
              <text className="mech-label" x="96" y={y + 2}>
                {station.name}
              </text>
              <text className="mech-mono" x="96" y={y + 30}>
                {station.code}
              </text>
              {station.name === "Referee" ? (
                <text className="mech-loss-text" x="96" y={y + 56}>
                  loses: swarm bury
                </text>
              ) : null}
            </g>
          );
        })}

        <rect className="mech-panel" height="370" rx="6" width="356" x="28" y="640" />
        <text className="mech-head" x="48" y="680">
          Your Supabase
        </text>
        <text className="mech-head" x="48" y="706">
          owns the memory
        </text>
        <path className="mech-line mech-mem" d="M72 744 V984" />
        {memory.map((stop, index) => (
          <g key={stop.name}>
            <circle className="mech-station" cx="72" cy={744 + index * 40} r="11" />
            <text className="mech-small" x="100" y={749 + index * 40}>
              {stop.name}
            </text>
          </g>
        ))}

        <path className="mech-loop" d="M206 1010 V1046 H12 V80 H42" />
        <text className="mech-label" x="36" y="1078">
          Learning loop
        </text>
        <text className="mech-note" x="36" y="1102">
          brief → plan; the improver tunes one skill.
        </text>
        <path className="mech-stop" d="M30 1122 V1166" />
        <text className="mech-label" x="48" y="1140">
          Frozen
        </text>
        <text className="mech-note" x="48" y="1162">
          referee · review · merge · scripts
        </text>
      </svg>

      <figcaption>
        Schematic, not a recording. Stations are GitHub nouns and <code>rallypoint swarm</code> commands;
        the memory stops are your own <code>swarm_*</code> tables.
      </figcaption>
    </figure>
  );
}
