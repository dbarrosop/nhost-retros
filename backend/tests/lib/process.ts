import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const repo = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));

// Never relay subprocess output/errors: CLI/SQL diagnostics can contain secrets.
export function command(file: string, args: string[], input?: string, timeout = 120_000): string {
  try {
    return execFileSync(file, args, {
      cwd: repo,
      encoding: "utf8",
      input,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    throw new Error(`${file} failed (exit ${status ?? "unavailable/timeout"}); output withheld`);
  }
}

// Test assertions must use sanitized messages, never token/password value matchers.
export function runProcess(
  file: string,
  args: string[],
  { env = process.env, timeoutMs = 600_000, killGraceMs = 5000 } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    // A finite runner-owned process group, not a persistent/background service.
    // Killing only pnpm leaves Playwright and its Vite server holding the stack lock.
    const child = spawn(file, args, { cwd: repo, env, stdio: "inherit", detached: true });
    let failure: string | undefined;
    let terminating = false;
    let closed = false;
    let finished = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const groups = new Set<number>(child.pid ? [child.pid] : []);
    const collectGroups = () => {
      if (!child.pid) return;
      // Playwright starts Vite/browsers in their own sessions. Capture only this
      // runner's descendant groups BEFORE signalling parents/reparenting orphans.
      // PID/PPID/PGID only: process arguments/environments may contain secrets.
      const rows = command("ps", ["-eo", "pid=,ppid=,pgid="], undefined, 5000)
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
      const descendants = new Set([child.pid]);
      let size = 0;
      while (size !== descendants.size) {
        size = descendants.size;
        for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid);
      }
      for (const [pid, , group] of rows)
        if (descendants.has(pid) && descendants.has(group)) groups.add(group);
    };
    const signalGroups = (signal: NodeJS.Signals) => {
      let signalled = false;
      for (const group of groups) {
        try {
          process.kill(-group, signal);
          signalled = true;
        } catch {
          // Already gone; do not signal unrelated processes or discover by name.
        }
      }
      return signalled;
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      if (failure) reject(new Error(`Test suite failed (${failure})`));
      else resolve();
    };
    const stop = () => {
      if (terminating) return;
      terminating = true;
      clearTimeout(timer);
      try {
        collectGroups();
      } catch {
        failure ??= "unable to inspect runner process groups";
      }
      if (!signalGroups("SIGTERM")) {
        if (closed || !child.pid) finish();
        return;
      }
      // Even if pnpm exits first, reap resistant descendants before returning.
      escalation = setTimeout(() => {
        signalGroups("SIGKILL");
        escalation = undefined;
        if (closed) finish();
      }, killGraceMs);
    };
    const interrupt = () => {
      failure = "signal SIGINT";
      stop();
    };
    const terminate = () => {
      failure = "signal SIGTERM";
      stop();
    };
    const timer = setTimeout(() => {
      failure = "timeout";
      stop();
    }, timeoutMs);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", () => {
      failure = "unable to start runner; diagnostics withheld";
      stop();
    });
    child.once("close", (code, signal) => {
      closed = true;
      if (code !== 0) failure ??= `exit ${code ?? signal}`;
      if (terminating) {
        if (!escalation) finish();
      } else stop();
    });
  });
}

export function runSuite(args: string[], env = process.env) {
  return runProcess("pnpm", args, { env });
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function main(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    // Only intentionally sanitized errors should cross this boundary.
    console.error(error instanceof Error ? error.message : "Test infrastructure failed");
    process.exitCode = 1;
  }
}
