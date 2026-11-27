import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

const CALL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 15_000;
export const DEFAULT_MAX_WAIT_MS = 2 * 60 * 60 * 1000;

const runCodex = (args, { cwd, input, timeout = CALL_TIMEOUT_MS } = {}) => spawnSync("codex", args, {
  cwd,
  input,
  encoding: "utf8",
  timeout,
  env: { ...process.env, NO_COLOR: "1" },
});

const taskUrlsFrom = (stdout) => [...new Set(
  stdout?.match(/https:\/\/[^\s/?#]+\/codex\/tasks\/[\w-]+/g) ?? [],
)];

export const dispatchCodexCloud = async (
  { cwd, environment, branch, prompt, onSubmitted, maxWaitMs = DEFAULT_MAX_WAIT_MS },
  { run = runCodex, wait = sleep, now = () => performance.now() } = {},
) => {
  const submission = run(
    ["cloud", "exec", "--env", environment, "--branch", branch, "--attempts", "1", "-"],
    { cwd, input: prompt },
  );
  const taskUrls = taskUrlsFrom(submission.stdout);
  const taskUrl = taskUrls.length === 1 ? taskUrls[0] : null;
  if (taskUrl) onSubmitted(taskUrl);
  if (submission.status !== 0 || !taskUrl) {
    if (submission.error?.code === "ENOENT") {
      throw new Error("Codex CLI was not found on PATH");
    }
    throw new Error(
      "Codex Cloud submission could not be confirmed. Check the Cloud task list before submitting again.",
    );
  }

  const deadline = now() + maxWaitMs;
  let failures = 0;
  while (now() < deadline) {
    const timeout = Math.max(1, Math.ceil(Math.min(CALL_TIMEOUT_MS, deadline - now())));
    const result = run(["cloud", "status", taskUrl], { cwd, timeout });
    // Codex returns nonzero for PENDING, ERROR and APPLIED. Read the status
    // label first so a pending task continues to occupy its slot.
    const status = result.stdout?.match(/^\[(PENDING|READY|APPLIED|ERROR)\](?:\s|$)/m)?.[1];
    if (!result.error && (status === "READY" || status === "APPLIED" || status === "ERROR")) {
      return { taskUrl, status: status.toLowerCase() };
    }
    failures = !result.error && status === "PENDING" ? 0 : failures + 1;
    if (failures >= 3) break;
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(POLL_INTERVAL_MS, remaining));
  }
  throw new Error(
    `Codex Cloud task status could not be confirmed. Keep the slot reserved and check ${taskUrl} before dispatching again.`,
  );
};
