// The prerequisite check every Rallypoint entry point runs before its first
// `gh` call.
//
// The decision is pure and the probe is injected, for exactly the reason
// `lib/gh.mjs` states in its own header: no test should be able to spawn a
// process or reach the live repository by importing one of these modules.
//
// Rallypoint drives GitHub through the `gh` CLI, and this repository cannot
// vendor it — it is a signed platform binary with its own release channel and
// its own credential store, so it is a declared prerequisite
// (`docs/TOOLING.md`) rather than a dependency. Before #247 a missing `gh`
// surfaced as a raw `execFileSync` ENOENT several calls into a claim, naming
// neither the binary that was missing nor the way to install it.

// `EX_UNAVAILABLE` from sysexits.h: "a required support program or file does
// not exist". It collides with none of the per-command exit tables in
// `docs/AGENT_LOOP.md`, which never exceed 9, so a merge gate branching on
// those codes cannot mistake an absent prerequisite for a real verdict.
//
// Not 127, the shell's "command not found", despite it reading better here.
// `pnpm run` propagates every other child exit code faithfully — 5 arrives as
// 5, 69 as 69 — but collapses 127 to 1, and 1 is `usage` in every one of those
// tables. Since #247 makes `pnpm run rallypoint:*` the documented invocation,
// 127 would have arrived at the caller as a plausible, wrong answer.
export const EXIT_MISSING_PREREQUISITE = 69;

export const GH_INSTALL_URL = "https://github.com/cli/cli#installation";

/**
 * `execFileSync` reports a missing binary as the string `ENOENT` on
 * `error.code`, while a `gh` that ran and exited non-zero puts a number there.
 * The two are told apart by type, not by value.
 *
 * @param {unknown} error
 */
const spawnCode = (error) => {
  const { code } = /** @type {{ code?: unknown }} */ (error ?? {});
  return typeof code === "string" ? code : "";
};

/**
 * The first informative line of a failure, so the message stays one screen
 * rather than a stack.
 *
 * @param {unknown} error
 */
const firstLine = (error) => {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (
    error ?? {}
  );
  const text = String(detail.stderr || detail.message || "").trim();
  return text.split("\n")[0] ?? "";
};

/** @param {string} problem */
export const missingGhMessage = (problem) =>
  [
    `Rallypoint needs the GitHub CLI (\`gh\`): ${problem}.`,
    "",
    "`gh` cannot be vendored into this repository, so it is a declared",
    "prerequisite rather than a dependency. Install it, then authenticate:",
    "",
    `  ${GH_INSTALL_URL}`,
    "  gh auth login",
    "",
    "`docs/TOOLING.md` records this prerequisite and the rest of the toolchain.",
  ].join("\n");

/**
 * Establishes that `gh` is present and runnable. Presence only: an installed
 * but unauthenticated `gh` runs, and its own error already names that problem
 * clearly, so this check does not duplicate it.
 *
 * @param {{ probe: () => unknown }} input `probe` runs `gh --version`.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export const checkGh = ({ probe }) => {
  try {
    probe();
    return { ok: true };
  } catch (error) {
    const code = spawnCode(error);

    if (code === "ENOENT") {
      return { ok: false, message: missingGhMessage("not found on PATH") };
    }

    if (code === "EACCES" || code === "EPERM") {
      return {
        ok: false,
        message: missingGhMessage("found on PATH but not executable"),
      };
    }

    const detail = firstLine(error);
    return {
      ok: false,
      message: missingGhMessage(
        detail ? `\`gh --version\` failed: ${detail}` : "`gh --version` failed",
      ),
    };
  }
};

export default checkGh;
