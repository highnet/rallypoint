// Making a claim visible on the remote from its first minute.
//
// ## Why this exists
//
// A janitor decides whether a claim is abandoned from what it can see, and
// almost everything it can see comes from GitHub. A worker, meanwhile, commits
// locally and pushes late — so a live session doing real work is indis-
// tinguishable from a dead one until it pushes something. A janitor running on
// the worker's own machine can consult `git worktree list` and tell the
// difference; a janitor running anywhere else cannot, and is left with exactly
// the GitHub-only evidence that was misleading in the first place.
//
// The beacon closes that gap at the one moment the protocol still has the
// session's attention. When `claim.mjs` records a claim, it also publishes the
// branch it just prescribed, pointing at the integration branch tip. From then
// on the claim is visible to every observer on every host, not just the one the
// worker happens to be sitting at.
//
// ## What this does not do
//
// It does not keep the signal fresh. A beacon pushed at the moment of the claim
// goes stale at exactly the same moment the claim comment does, so it extends
// `release-claim.mjs`'s "no issue branch moved inside `staleClaimHours`" guard
// by precisely zero minutes. Only a branch that keeps moving does that, and
// nothing here can make a worker push again — `claim.mjs` is the last point
// where the protocol holds the session's hand.

/**
 * @typedef {{
 *   integrationBranch?: string,
 *   branchPrefix: string,
 * }} BeaconPushConfig
 */

/** @param {unknown} error */
const describe = (error) =>
  error instanceof Error ? error.message.split("\n")[0] : String(error);

/**
 * Publish the branch a claim just prescribed, pointing at the integration
 * branch tip.
 *
 * Best-effort by design: every failure path reports and returns rather than
 * throwing, because the claim itself has already succeeded by the time this
 * runs and an unpublished branch is a weaker signal, not a broken claim.
 *
 * @param {{
 *   branch: string,
 *   config: BeaconPushConfig,
 *   git: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} options
 * @returns {{ pushed: boolean, reason: string }}
 */
export const beaconPush = ({
  branch,
  config,
  git,
  stdout = () => {},
  stderr = () => {},
}) => {
  const integration = config.integrationBranch ?? "main";
  const remoteIntegration = `origin/${integration}`;

  let head;
  try {
    head = git("rev-parse", "HEAD");
  } catch (error) {
    const reason = `HEAD could not be read (${describe(error)})`;
    stderr(`No beacon push: ${reason}.`);
    return { pushed: false, reason };
  }

  // The whole justification for the `--no-verify` below. Not a heuristic and
  // not advisory: a HEAD the remote integration branch does not already contain
  // is a commit this repository's pre-push checks have a real opinion about, so
  // it does not get a free ride. Nothing is pushed in that case — falling back
  // to a verified push would block a claim for however long those checks take,
  // which is worse than no beacon.
  try {
    git("merge-base", "--is-ancestor", head, remoteIntegration);
  } catch {
    const reason =
      `HEAD (${head.slice(0, 8)}) is not already contained in ` +
      `${remoteIntegration}, so pushing it would skip this repository's ` +
      "pre-push checks for commits they have not seen";
    stderr(`No beacon push: ${reason}. Push the branch yourself instead.`);
    return { pushed: false, reason };
  }

  // Created so the worker can `git checkout` it immediately. An existing branch
  // of the same name is left exactly as it is — it may be another worktree's
  // checkout, and this is not the place to move anybody's branch.
  try {
    git("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
  } catch {
    try {
      git("branch", branch, head);
    } catch (error) {
      stderr(`Local branch ${branch} could not be created: ${describe(error)}.`);
    }
  }

  // An explicit refspec rather than a checkout: `claim.mjs` runs in the
  // worker's own tree and must not move it. `--no-verify` is safe here and only
  // here, by the ancestry proof above.
  try {
    git("push", "--no-verify", "origin", `${head}:refs/heads/${branch}`);
  } catch (error) {
    const reason = `push failed (${describe(error)})`;
    stderr(
      `No beacon push: ${reason}. The claim stands; push ${branch} yourself.`,
    );
    return { pushed: false, reason };
  }

  stdout(`CLAIM_BRANCH_PUSHED=${branch}`);
  return { pushed: true, reason: "published at the integration branch tip" };
};

export default beaconPush;
