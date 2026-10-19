/**
 * Two worker sessions race for the same issue. Both try to create the same
 * reservation ref; GitHub creates it once. Drawn as a transit schematic: lines
 * are sessions, the interchange is the ref, the branch is where the loser goes.
 */
const REF = "refs/heads/rallypoint-claims/issue-142";

export function ClaimRace() {
  return (
    <figure className="claim-race">
      {/* Wide schematic: tablet and desktop */}
      <svg
        aria-labelledby="race-title race-desc"
        className="race-svg race-wide"
        role="img"
        viewBox="0 0 1200 360"
      >
        <title id="race-title">Two workers race to claim issue 142</title>
        <desc id="race-desc">
          worker-a3f9 creates {REF} first and claims issue 142. worker-7c21
          tries to create the same ref, GitHub refuses the second creation, and
          it moves on to issue 143 without touching 142.
        </desc>

        {/* winner */}
        <path className="race-line race-win" d="M60 110 H1080" />
        {/* loser: runs in, stops at the interchange, branches at 45° */}
        <path className="race-line race-lose" d="M60 250 H436" />
        <path className="race-line race-lose race-branch" d="M372 250 L432 310 H1080" />

        <rect className="race-box" height="250" rx="2" width="300" x="450" y="55" />
        <text className="race-box-kicker" x="474" y="92">
          create ref — once only
        </text>
        <text className="race-mono" x="474" y="122">
          refs/heads/
        </text>
        <text className="race-mono" x="474" y="146">
          rallypoint-claims/
        </text>
        <text className="race-mono race-strong" x="474" y="170">
          issue-142
        </text>
        <line className="race-stop" x1="450" x2="450" y1="226" y2="274" />
        <text className="race-refused" x="474" y="246">
          Refused:
        </text>
        <text className="race-refused" x="474" y="270">
          reference already exists
        </text>

        <circle className="race-station" cx="60" cy="110" r="14" />
        <circle className="race-station" cx="60" cy="250" r="14" />
        <circle className="race-station race-end" cx="1080" cy="110" r="16" />
        <circle className="race-station" cx="1080" cy="310" r="14" />

        <text className="race-label" x="60" y="72">
          worker-a3f9
        </text>
        <text className="race-sub" x="60" y="152">
          1st to arrive
        </text>
        <text className="race-label" x="60" y="212">
          worker-7c21
        </text>
        <text className="race-sub" x="60" y="292">
          2nd to arrive
        </text>
        <text className="race-label" textAnchor="end" x="1080" y="72">
          #142 status:claimed
        </text>
        <text className="race-sub" textAnchor="end" x="1080" y="152">
          then the label, the assignee, the branch
        </text>
        <text className="race-label" textAnchor="end" x="1080" y="272">
          #143 next candidate
        </text>
        <text className="race-sub" textAnchor="end" x="1080" y="350">
          #142 never touched
        </text>
      </svg>

      {/* Tall schematic: phones */}
      <svg
        aria-labelledby="race-title-m race-desc-m"
        className="race-svg race-tall"
        role="img"
        viewBox="0 0 360 640"
      >
        <title id="race-title-m">Two workers race to claim issue 142</title>
        <desc id="race-desc-m">
          worker-a3f9 creates the reservation ref first and claims issue 142.
          worker-7c21 is refused and moves on to issue 143.
        </desc>
        <path className="race-line race-win" d="M90 70 V580" />
        <path className="race-line race-lose" d="M270 70 V222" />
        <path className="race-line race-lose race-branch" d="M270 180 L300 210 V580" />

        <rect className="race-box" height="190" rx="2" width="236" x="40" y="236" />
        <line className="race-stop" x1="246" x2="294" y1="236" y2="236" />
        <text className="race-box-kicker" x="58" y="268">
          create ref — once only
        </text>
        <text className="race-mono" x="58" y="298">
          refs/heads/
        </text>
        <text className="race-mono" x="58" y="320">
          rallypoint-claims/
        </text>
        <text className="race-mono race-strong" x="58" y="342">
          issue-142
        </text>
        <text className="race-refused" x="58" y="384">
          2nd create refused:
        </text>
        <text className="race-refused" x="58" y="406">
          reference already exists
        </text>

        <circle className="race-station" cx="90" cy="70" r="12" />
        <circle className="race-station" cx="270" cy="70" r="12" />
        <circle className="race-station race-end" cx="90" cy="580" r="14" />
        <circle className="race-station" cx="300" cy="580" r="12" />

        <text className="race-label" textAnchor="middle" x="90" y="38">
          worker-a3f9
        </text>
        <text className="race-label" textAnchor="middle" x="270" y="38">
          worker-7c21
        </text>
        <text className="race-label" x="20" y="622">
          #142 claimed
        </text>
        <text className="race-label" textAnchor="end" x="350" y="622">
          #143 next
        </text>
      </svg>
      <figcaption>
        Several sessions may share one GitHub identity, so an assignee proves
        nothing about who arrived first. The ref does: <code>claim.mjs</code>{" "}
        reserves before it mutates, and skips a contended issue without
        touching it.
      </figcaption>
    </figure>
  );
}
