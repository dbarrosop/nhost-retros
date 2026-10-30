import { execFileSync, spawnSync } from "node:child_process";
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
export function runSuite(args: string[], env = process.env) {
  const result = spawnSync("pnpm", args, { cwd: repo, env, stdio: "inherit", timeout: 300_000 });
  if (result.status !== 0)
    throw new Error(`Test suite failed (exit ${result.status ?? "timeout"})`);
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
