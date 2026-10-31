import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "./lib/process.ts";

function canExecute(pid: number) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
    if (["Z", "X"].includes(fields[0]) || (BigInt(fields[6]) & 4n) !== 0n) return false;
    // SIGKILL is asynchronous: /proc can briefly show R while the fatal signal
    // is pending or PF_EXITING is set. Neither task can return to user code.
    // Do not require the container's PID 1 to reap orphan zombies synchronously.
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return ![...status.matchAll(/^(?:SigPnd|ShdPnd):\s+([\da-f]+)$/gm)].some(
      (match) => (BigInt(`0x${match[1]}`) & 256n) !== 0n,
    );
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

describe("finite test process groups", () => {
  it("reports success, exit failure and unavailable commands without raw diagnostics", async () => {
    await expect(runProcess(process.execPath, ["-e", "process.exit(0)"])).resolves.toBeUndefined();
    await expect(runProcess(process.execPath, ["-e", "process.exit(7)"])).rejects.toThrow(
      "Test suite failed (exit 7)",
    );
    await expect(runProcess("/missing/retro-test-runner", [])).rejects.toThrow(
      "unable to start runner; diagnostics withheld",
    );
  });

  it.each(["timeout", "exit"])(
    "kills resistant descendants after %s before returning",
    async (mode) => {
      const dir = mkdtempSync(join(tmpdir(), "retro-process-"));
      const marker = join(dir, "pid");
      const descendant = `
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      process.on('SIGTERM', () => {});
      process.send('ready');
      setInterval(() => {}, 1000);
    `;
      const parent = `
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {detached: ${mode === "timeout"}, stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
      ${mode === "exit" ? "child.on('message', () => { child.disconnect(); process.exitCode = 7; child.unref(); });" : "setInterval(() => {}, 1000);"}
    `;
      try {
        await expect(
          runProcess(process.execPath, ["-e", parent], { timeoutMs: 1000, killGraceMs: 100 }),
        ).rejects.toThrow(mode === "timeout" ? "timeout" : "exit 7");
        const pid = Number(readFileSync(marker, "utf8"));
        expect(canExecute(pid)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
