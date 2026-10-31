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
type ProcessOptions = { env?: NodeJS.ProcessEnv; timeoutMs?: number; killGraceMs?: number };

// Captured CLI output is private, unlike the intentionally sanitized suite output.
export async function commandAsync(
  file: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<string> {
  try {
    return await ownedProcess(file, args, { ...options, capture: true });
  } catch (error) {
    throw new Error(`${file} failed (${(error as Error).message}); output withheld`);
  }
}

export async function runProcess(file: string, args: string[], options: ProcessOptions = {}) {
  try {
    await ownedProcess(file, args, options);
  } catch (error) {
    throw new Error(`Test suite failed (${(error as Error).message})`);
  }
}

function ownedProcess(
  file: string,
  args: string[],
  { env = process.env, timeoutMs = 600_000, killGraceMs = 5000, capture = false } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    // A finite runner-owned process group, not a persistent/background service.
    // Killing only pnpm leaves Playwright and its Vite server holding the stack lock.
    const child = spawn(file, args, {
      cwd: repo,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      detached: true,
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let failure: string | undefined;
    let terminating = false;
    let groupsSignalled = false;
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
      if (failure) reject(new Error(failure));
      else resolve(Buffer.concat(output).toString("utf8"));
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
      groupsSignalled = signalGroups("SIGTERM");
      if (!groupsSignalled && (closed || !child.pid)) {
        finish();
        return;
      }
      // Even if the original group has exited, retained pipes get a hard cap.
      // Normal close can still finish immediately when no group needs cleanup.
      // Otherwise reap resistant captured descendants before returning.
      escalation = setTimeout(() => {
        signalGroups("SIGKILL");
        escalation = undefined;
        // Escaped/inherited pipes must not keep the owner/lock alive after the
        // hard deadline. No output is relayed; close our pipe ends explicitly.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish();
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
    for (const [stream, collect] of [
      [child.stdout, true],
      [child.stderr, false],
    ] as const) {
      stream?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) {
          failure = "output limit exceeded";
          stop();
        } else if (collect) output.push(chunk);
      });
    }
    // exit precedes close: a grandchild can hold inherited pipes open indefinitely.
    child.once("exit", (code, signal) => {
      if (code !== 0) failure ??= `exit ${code ?? signal}`;
      stop();
    });
    child.once("close", (code, signal) => {
      closed = true;
      if (code !== 0) failure ??= `exit ${code ?? signal}`;
      if (terminating) {
        if (!escalation || !groupsSignalled) finish();
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
