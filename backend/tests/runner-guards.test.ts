import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({
  guard: vi.fn(),
  connect: vi.fn(),
  connectLocalOperator: vi.fn(),
  connectDeveloper: vi.fn(),
  developerAccountId: vi.fn(),
  applyDeveloper: vi.fn(),
  setFacilitator: vi.fn(),
  compose: vi.fn(),
  provision: vi.fn(),
  health: vi.fn(),
  freePort: vi.fn(),
  applyMigrations: vi.fn(),
  synchronizeMetadata: vi.fn(),
  migrationRoundtrip: vi.fn(),
  runSuite: vi.fn(),
  rmSync: vi.fn(),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  rmSync: effects.rmSync,
}));
vi.mock("./lib/process.ts", async (original) => ({
  ...(await original<typeof import("./lib/process.ts")>()),
  main: (action: () => Promise<void>) => action(),
  runSuite: effects.runSuite,
}));
vi.mock("./lib/target.ts", async (original) => ({
  ...(await original<typeof import("./lib/target.ts")>()),
  guard: effects.guard,
  connect: effects.connect,
  compose: effects.compose,
  provision: effects.provision,
  freePort: effects.freePort,
  locked: (action: () => Promise<void>) => action(),
}));
vi.mock("./lib/operator-db.ts", () => ({ connectLocalOperator: effects.connectLocalOperator }));
vi.mock("./lib/developer.ts", () => ({
  connectDeveloper: effects.connectDeveloper,
  developerAccountId: effects.developerAccountId,
  applyDeveloper: effects.applyDeveloper,
}));
vi.mock("../scripts/facilitator.ts", () => ({ setFacilitator: effects.setFacilitator }));
vi.mock("./lib/api.ts", () => ({
  health: effects.health,
  synchronizeMetadata: effects.synchronizeMetadata,
}));
vi.mock("./lib/migrations.ts", () => ({
  applyMigrations: effects.applyMigrations,
  migrationRoundtrip: effects.migrationRoundtrip,
}));

const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  process.argv = originalArgv;
});

describe("destructive/acceptance entrypoints fail closed", () => {
  it("does not provision roles when the developer identity guard rejects", async () => {
    effects.connectDeveloper.mockRejectedValue(new Error("Developer identity refused"));
    process.argv = [process.execPath, "facilitator.ts", "grant", "person@nhost.io", "--developer"];
    await expect(import("../../scripts/facilitator.ts")).rejects.toThrow(
      "Developer identity refused",
    );
    expect(effects.connectDeveloper).toHaveBeenCalledOnce();
    for (const [effect, fn] of Object.entries(effects))
      if (effect !== "connectDeveloper") expect(fn, effect).not.toHaveBeenCalled();
  });
  for (const refusal of ["No registered disposable target", "Refused remote/non-disposable target"])
    for (const [name, load, args] of [
      ["stop", () => import("../../scripts/test-target.ts"), ["stop"]],
      ["destroy", () => import("../../scripts/test-target.ts"), ["destroy"]],
      ["backend", () => import("../../scripts/run-backend.ts"), []],
      ["migrations", () => import("../../scripts/run-migrations.ts"), []],
      ["browser", () => import("../../scripts/run-e2e.ts"), ["--engine", "hasura"]],
      [
        "facilitator",
        () => import("../../scripts/facilitator.ts"),
        ["grant", "00000000-0000-0000-0000-000000000000", "--test-target"],
      ],
    ] as const) {
      it(`${name} propagates ${refusal} before any side effects`, async () => {
        effects.guard.mockRejectedValue(new Error(refusal));
        process.argv = [process.execPath, "acceptance-entrypoint.ts", ...args];
        await expect(load()).rejects.toThrow(refusal);
        expect(effects.guard).toHaveBeenCalledOnce();
        for (const [effect, fn] of Object.entries(effects))
          if (effect !== "guard") expect(fn, effect).not.toHaveBeenCalled();
      });
    }

  for (const [name, load, args] of [
    ["destroy", () => import("../../scripts/test-target.ts"), ["destroy", "backend"]],
    [
      "provision",
      () => import("../../scripts/test-target.ts"),
      ["provision", "--root-folder", "backend"],
    ],
    ["local apply", () => import("../../scripts/apply-local.ts"), ["--target", "https://remote"]],
    ["backend", () => import("../../scripts/run-backend.ts"), ["--target", "backend"]],
    ["migrations", () => import("../../scripts/run-migrations.ts"), ["--target", "https://remote"]],
    ["browser", () => import("../../scripts/run-e2e.ts"), ["--engine", "https://remote"]],
  ] as const)
    it(`${name} rejects target-like arguments before even resolving a target`, async () => {
      process.argv = [process.execPath, "acceptance-entrypoint.ts", ...args];
      await expect(load()).rejects.toThrow(/Usage|no target overrides/);
      for (const fn of Object.values(effects)) expect(fn).not.toHaveBeenCalled();
    });
});
