import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const runCodex = (args, { cwd, input } = {}) => spawnSync("codex", args, {
  cwd,
  input,
  encoding: "utf8",
  timeout: 60_000,
  env: { ...process.env, NO_COLOR: "1" },
});

const taskUrlFrom = (stdout) => {
  const url = stdout?.trim();
  if (!/^https:\/\/[^\s/?#]+\/codex\/tasks\/[\w-]+$/.test(url ?? "")) return null;
  return url;
};

export const dispatchCodexCloud = async (
  { cwd, environment, branch, prompt, onSubmitted },
  { run = runCodex, wait = sleep } = {},
) => {
  const submission = run(
    ["cloud", "exec", "--env", environment, "--branch", branch, "--attempts", "1", "-"],
    { cwd, input: prompt },
  );
  const taskUrl = taskUrlFrom(submission.stdout);
  if (taskUrl) onSubmitted(taskUrl);
  if (submission.status !== 0 || !taskUrl) {
    if (submission.error?.code === "ENOENT") {
      throw new Error("Codex CLI was not found on PATH");
    }
    throw new Error(
      "Codex Cloud submission could not be confirmed. Check the Cloud task list before submitting again.",
    );
  }

  for (;;) {
    const result = run(["cloud", "status", taskUrl], { cwd });
    // Codex returns nonzero for PENDING, ERROR and APPLIED. Read the status
    // label first so a pending task continues to occupy its slot.
    const status = result.stdout?.match(/^\[(PENDING|READY|APPLIED|ERROR)\](?:\s|$)/m)?.[1];
    if (!result.error && status === "PENDING") {
      await wait(15_000);
      continue;
    }
    if (!result.error && (status === "READY" || status === "APPLIED" || status === "ERROR")) {
      return { taskUrl, status: status.toLowerCase() };
    }
    throw new Error(
      `Codex Cloud task status could not be confirmed. Keep the slot reserved and check ${taskUrl} before dispatching again.`,
    );
  }
};
