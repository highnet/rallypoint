import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const runtimes = {
  "claude-local": { executable: "claude", packageName: "@anthropic-ai/claude-code", args: ["-p"] },
  "codex-local": { executable: "codex", packageName: "@openai/codex", args: ["exec", "--full-auto", "-"] },
};

const commandFor = ({ executable, packageName }, { env, platform }) => {
  if (platform === "win32") {
    const path = Object.entries(env).find(([name]) => name.toUpperCase() === "PATH")?.[1] ?? "";
    for (const entry of path.split(";").filter(Boolean)) {
      const dir = entry.replace(/^"|"$/g, "");
      const native = join(dir, `${executable}.exe`);
      if (existsSync(native)) return [native];
      // Windows npm installs a .cmd shim beside node_modules. Start its
      // package entry point with Node so the prompt never goes through cmd.exe.
      const packageDir = join(dir, "node_modules", packageName);
      const manifest = join(packageDir, "package.json");
      if (!existsSync(join(dir, `${executable}.cmd`)) || !existsSync(manifest)) continue;
      const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
      const script = typeof bin === "string" ? bin : bin?.[executable];
      if (script && existsSync(join(packageDir, script))) return [process.execPath, join(packageDir, script)];
    }
  }
  return [executable];
};

const installFix = ({ executable, packageName }) =>
  `${executable} CLI was not found on PATH. Install it with npm install -g ${packageName} and reopen your terminal.`;

export const doctorRuntime = (runtime, { cwd, env = process.env, platform = process.platform } = {}) => {
  const spec = runtimes[runtime === "codex-cloud" ? "codex-local" : runtime];
  const [command, ...prefix] = commandFor(spec, { env, platform });
  const run = (...args) => spawnSync(command, [...prefix, ...args], {
    cwd, env, timeout: 10_000, stdio: "ignore", shell: false,
  });
  const version = run("--version");
  if (version.error?.code === "ENOENT") return { ok: false, detail: installFix(spec) };
  if (version.status !== 0) return { ok: false, detail: `${spec.executable} --version failed. Update or reinstall ${spec.packageName} and retry.` };
  const auth = spec.executable === "codex" ? ["login", "status"] : ["auth", "status"];
  if (run(...auth).status !== 0) {
    const fix = spec.executable === "codex" ? "codex login" : "claude auth login";
    return { ok: false, detail: `${spec.executable} ${auth.join(" ")} failed. Run ${fix} and retry.` };
  }
  return { ok: true, detail: `${spec.executable} CLI is on PATH and reports an active login.` };
};

export const dispatchLocal = ({ runtime, cwd, prompt, maxWaitMs, env = process.env, platform = process.platform }) =>
  new Promise((resolve, reject) => {
    const spec = runtimes[runtime];
    const [command, ...prefix] = commandFor(spec, { env, platform });
    const child = spawn(command, [...prefix, ...spec.args], {
      cwd, env, shell: false, detached: process.platform !== "win32",
      stdio: ["pipe", "inherit", "inherit"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      // npm entry points may launch the real CLI as a grandchild.
      if (process.platform === "win32") {
        const treeKill = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore", shell: false, timeout: 5000,
        });
        if (treeKill.status !== 0) child.kill("SIGKILL");
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") child.kill("SIGKILL");
        }
      }
    }, maxWaitMs);
    const forwardInterrupt = () => {
      // A foreground CLI receives Ctrl-C directly on Windows. On POSIX
      // the process group is separate so a timeout can reach its children.
      try {
        process.kill(-child.pid, "SIGINT");
      } catch (error) {
        if (error.code !== "ESRCH") child.kill("SIGINT");
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.off("SIGINT", forwardInterrupt);
    };
    if (process.platform !== "win32" && child.pid) process.on("SIGINT", forwardInterrupt);
    child.once("error", (error) => {
      cleanup();
      reject(error.code === "ENOENT" ? new Error(installFix(spec)) : error);
    });
    child.once("close", (status, signal) => {
      cleanup();
      if (timedOut) {
        reject(new Error(`${runtime} timed out and its process was killed. Inspect the role session and its retro before retrying.`));
      } else if (status === null) {
        reject(new Error(`${runtime} exited on ${signal}. Inspect the role session before retrying.`));
      } else {
        resolve(status);
      }
    });
    // A CLI that exits before consuming stdin still owns its exit status.
    child.stdin.on("error", (error) => {
      if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code)) reject(error);
    });
    child.stdin.end(prompt);
  });
