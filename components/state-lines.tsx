import { RotateCcw } from "lucide-react";

import { LabelChip } from "@/components/label-chip";
import { labelSpecs, type LabelKey } from "@/lib/labels";

/**
 * The label state machine as a two-line transit strip map: one line for the
 * issue, one for its pull request. Stops are states; the chips are the labels
 * exactly as GitHub shows them.
 */
export function StateLines() {
  return (
    <div className="lines">
      <div className="line line-issue">
        <h3 className="line-name">
          <span aria-hidden="true" className="line-bullet" />
          Issue
        </h3>
        <ol className="line-stops">
          <li className="stop">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">Claimable</p>
            <p className="stop-note">Open, no assignee, no hold label. Filing an issue makes it claimable.</p>
          </li>
          <li className="stop">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">
              <LabelChip label="claimed" />
            </p>
            <p className="stop-note">
              Set by <code>claim.mjs</code> only after the reservation ref exists.{" "}
              <code>release-claim.mjs</code> returns it to the pool.
            </p>
          </li>
          <li className="stop stop-terminal">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">Closed</p>
            <p className="stop-note">
              <code>Closes #N</code> lands, the claim is released. <code>Refs #N</code> releases it and leaves the issue open.
            </p>
          </li>
        </ol>
        <div className="line-branch">
          <p className="branch-title">Held out of the pool</p>
          <ul>
            <li>
              <LabelChip label="blocked" />
              <span>Only with a <code>Blocked-By: #41</code> trailer; clears itself when the last blocker closes.</span>
            </li>
            <li>
              <LabelChip label="deferred" />
              <span>A deliberate hold that will not clear on its own.</span>
            </li>
            <li>
              <LabelChip label="human" />
              <span>An owner decision. No automated writer may remove it.</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="line line-pr">
        <h3 className="line-name">
          <span aria-hidden="true" className="line-bullet" />
          Pull request
        </h3>
        <ol className="line-stops">
          <li className="stop">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">Ready for review</p>
            <p className="stop-note">
              One branch, <code>agent/&lt;issue&gt;-&lt;slug&gt;</code>, body says <code>Closes #N</code>.
            </p>
          </li>
          <li className="stop stop-loop">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">
              <LabelChip label="changesRequested" />
            </p>
            <p className="stop-note">
              <RotateCcw aria-hidden="true" className="stop-loop-icon" />
              The fixer pushes to the same branch; the head moves, the verdict stops binding, review runs again.
            </p>
          </li>
          <li className="stop">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">
              <LabelChip label="approved" />
            </p>
            <p className="stop-note">
              Applied only by <code>review.mjs</code>, bound to one head SHA, never from the author’s own session.
            </p>
          </li>
          <li className="stop stop-terminal">
            <span aria-hidden="true" className="stop-node" />
            <p className="stop-state">Merged</p>
            <p className="stop-note">The merger checks CI itself and that the head has not moved since the verdict.</p>
          </li>
        </ol>
        <div className="line-branch">
          <p className="branch-title">Flagged, never hidden</p>
          <ul>
            <li>
              <LabelChip label="mergedUnreviewed" />
              <span>Merged without an approve verdict at its head.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const tableOrder: LabelKey[] = [
  "claimed",
  "blocked",
  "deferred",
  "human",
  "approved",
  "changesRequested",
  "mergedUnreviewed",
];

export function LabelTable() {
  return (
    <div className="table-wrap">
      <table className="code-table">
        <caption className="sr-only">Rallypoint labels, their config keys, and meanings</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">Config key</th>
            <th scope="col">On</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {tableOrder.map((key) => {
            const spec = labelSpecs[key];
            return (
              <tr key={key}>
                <th scope="row">
                  <LabelChip label={key} />
                </th>
                <td data-label="Config key">
                  <code>{"configKey" in spec ? spec.configKey : ""}</code>
                </td>
                <td data-label="On">{spec.scope}</td>
                <td data-label="Meaning">{spec.meaning}</td>
              </tr>
            );
          })}
          <tr>
            <th scope="row">
              <LabelChip label="p1" />
            </th>
            <td data-label="Config key">
              <code>prio:p0 … prio:p9</code>
            </td>
            <td data-label="On">issue</td>
            <td data-label="Meaning">{labelSpecs.p1.meaning}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
