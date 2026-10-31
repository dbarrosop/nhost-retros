import { createHash } from "node:crypto";
import { join } from "node:path";
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDeveloper,
  applyDeveloperMigrations,
  developerAccountId,
  developerCliApplied,
  developerCliHistory,
  developerComposeArgs,
  mergeRetroMetadata,
  validateDeveloperService,
} from "./lib/developer.ts";
import { repo } from "./lib/process.ts";

const effects = vi.hoisted(() => ({
  command: vi.fn(),
  client: vi.fn(),
  backup: vi.fn(),
  mkdir: vi.fn(),
}));
const sqlMigrations = vi.hoisted(() => [
  { name: "1_first", up: "UP first", down: "DOWN first" },
  {
    name: "2_second",
    up: "UPDATE public.retro_answers SET text = text || ' backfilled'",
    down: "DOWN second",
  },
]);
vi.mock("./lib/migrations.ts", () => ({ migrations: () => sqlMigrations }));
vi.mock("./lib/process.ts", async (original) => ({
  ...(await original<typeof import("./lib/process.ts")>()),
  command: effects.command,
}));
vi.mock("./lib/target.ts", async (original) => ({
  ...(await original<typeof import("./lib/target.ts")>()),
  localDocker: vi.fn(),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  realpathSync: (path: string) => path,
  mkdirSync: effects.mkdir,
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: effects.backup,
}));
vi.mock("pg", async (original) => ({
  default: { ...(await original<typeof import("pg")>()).default, Client: effects.client },
}));
beforeEach(() => vi.clearAllMocks());

function checksum(index: number) {
  const migration = sqlMigrations[index];
  return createHash("sha256")
    .update(JSON.stringify([migration.up, migration.down]))
    .digest("hex");
}
function service(name = "postgres") {
  return {
    Id: "test-only",
    Config: {
      Env: [],
      Labels: {
        "com.docker.compose.project": "backend",
        "com.docker.compose.service": name,
        "com.docker.compose.project.config_files": join(repo, "backend/.nhost/docker-compose.yaml"),
      },
    },
    State: { Running: true },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostPort: "5432" }] } },
    Mounts: [
      { Type: "bind", Source: join(repo, "backend/nhost/metadata"), Destination: "/metadata" },
    ],
  };
}
function database(recorded?: [string, string][]) {
  let ledger = recorded !== undefined;
  let conflict = false;
  let failure = "";
  const history = new Map(recorded);
  const query = vi.fn(async (sql: string, values?: string[]) => {
    if (sql.startsWith("SELECT to_regclass")) return { rows: [{ name: ledger ? "ledger" : null }] };
    if (sql.startsWith("SELECT 1 FROM pg_class")) return { rows: [], rowCount: conflict ? 1 : 0 };
    if (sql.startsWith("CREATE SCHEMA")) ledger = true;
    if (sql.startsWith("SELECT name,checksum FROM"))
      return { rows: [...history].map(([name, checksum]) => ({ name, checksum })) };
    if (sql === failure) throw new Error("Sensitive SQL details must not surface");
    if (sql.startsWith("INSERT INTO retro_local_operations"))
      history.set(values?.[0] ?? "", values?.[1] ?? "");
    return { rows: [], rowCount: 0 };
  });
  return {
    db: { query } as unknown as pg.Client,
    query,
    history,
    conflict: () => {
      conflict = true;
    },
    fail: (sql: string) => {
      failure = sql;
    },
  };
}

function expectNoWrites(app: ReturnType<typeof database>) {
  expect(app.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
}

describe("additive developer operations", () => {
  it("mirrors only unambiguously known CLI state, refusing absent sources and dirty/unknown status", () => {
    expect(developerCliApplied("123  app  Present  Present\n", "123")).toBe(true);
    expect(developerCliApplied("123  app  Present  Not Present\n", "123")).toBe(false);
    for (const output of [
      "",
      "123 app Not Present Present",
      "123 app Present Dirty",
      "123 app Present Present Dirty",
      "123 app Present Present\n123 app Present Present",
    ])
      expect(() => developerCliApplied(output, "123")).toThrow();
    expect(() => developerCliApplied("", "123; unsafe")).toThrow();
  });
  it("accepts only the fixed repository Compose project, ports and metadata mount", () => {
    expect(developerComposeArgs).toContain("--project-directory");
    expect(developerComposeArgs[developerComposeArgs.indexOf("--project-directory") + 1]).toBe(
      join(repo, "backend"),
    );
    expect(validateDeveloperService(service(), "postgres")).toBeTruthy();
    expect(validateDeveloperService(service("constellation"), "constellation")).toBeTruthy();
    for (const labels of [
      { "com.docker.compose.project": "retro-test-other" },
      { "com.docker.compose.project.config_files": "/another/backend/.nhost/docker-compose.yaml" },
      { "com.docker.compose.service": "remote" },
    ]) {
      const value = service();
      Object.assign(value.Config.Labels, labels);
      expect(() => validateDeveloperService(value, "postgres")).toThrow();
    }
    const stopped = service();
    stopped.State.Running = false;
    expect(() => validateDeveloperService(stopped, "postgres")).toThrow();
    const port = service();
    port.NetworkSettings.Ports["5432/tcp"][0].HostPort = "55432";
    expect(() => validateDeveloperService(port, "postgres")).toThrow();
    const mount = service("constellation");
    mount.Mounts[0].Source = "/other/metadata";
    expect(() => validateDeveloperService(mount, "constellation")).toThrow();
  });
  it("merges only application tables while preserving unrelated metadata and source configuration", () => {
    const table = (schema: string, name: string) => ({ table: { schema, name } });
    const custom = { ...table("public", "developer_notes"), select_permissions: ["kept"] };
    const existing = {
      version: 3,
      actions: ["kept"],
      sources: [
        {
          name: "default",
          configuration: { connection: "kept" },
          tables: [table("auth", "users"), custom, table("public", "retro_sessions")],
        },
        { name: "other", tables: [table("public", "unrelated")] },
      ],
    };
    const next = {
      sources: [
        {
          name: "default",
          tables: [table("auth", "do_not_overwrite"), table("public", "retro_answers")],
        },
      ],
    };
    const merged = mergeRetroMetadata(existing, next);
    expect(merged.actions).toEqual(["kept"]);
    expect(merged.sources[0].configuration).toEqual({ connection: "kept" });
    expect(merged.sources[0].tables).toEqual([
      table("auth", "users"),
      custom,
      table("public", "retro_answers"),
    ]);
    expect(merged.sources[1]).toBe(existing.sources[1]);
    expect(existing.sources[0].tables).toHaveLength(3);
  });
  it("applies fresh ups transactionally, records checksums and is a full no-op on reapply", async () => {
    const app = database();
    const notApplied = developerCliHistory(
      "1 first Present Not Present\n2 second Present Not Present",
    );
    await applyDeveloperMigrations(app.db, notApplied);
    expect([...app.history]).toEqual([
      ["1_first", checksum(0)],
      ["2_second", checksum(1)],
    ]);
    expect(app.query.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(2);
    expect(app.query).toHaveBeenCalledWith(sqlMigrations[0].up);
    expect(app.query).toHaveBeenCalledWith(sqlMigrations[1].up);
    for (const cliApplied of [
      developerCliHistory("1 first Present Present\n2 second Present Present"),
      notApplied, // A previous run committed SQL but did not mirror CLI state yet.
    ]) {
      app.query.mockClear();
      await applyDeveloperMigrations(app.db, cliApplied);
      expectNoWrites(app);
    }
  });
  it("never adopts or replays an unrecorded CLI-applied backfill, even with an existing ledger", async () => {
    for (const recorded of [undefined, [["1_first", checksum(0)]] as [string, string][]]) {
      const app = database(recorded);
      const before = new Map(app.history);
      await expect(
        applyDeveloperMigrations(
          app.db,
          developerCliHistory("1 first Present Not Present\n2 second Present Present"),
        ),
      ).rejects.toThrow("CLI-applied local migration lacks a verified checksum");
      expectNoWrites(app); // No BEGIN, DDL, UP/backfill, DOWN or ledger INSERT.
      expect(app.history).toEqual(before);
    }
  });
  it.each([0, 1])(
    "validates all checksums before executing any pending SQL (mismatch %i)",
    async (index) => {
      const app = database([[sqlMigrations[index].name, "changed"]]);
      const before = new Map(app.history);
      await expect(applyDeveloperMigrations(app.db, new Set())).rejects.toThrow(
        "Changed applied local migration",
      );
      expectNoWrites(app);
      expect(app.history).toEqual(before);
    },
  );
  it("refuses unrecorded/unknown history and rolls back a failed up without running down", async () => {
    const conflict = database();
    conflict.conflict();
    await expect(applyDeveloperMigrations(conflict.db, new Set())).rejects.toThrow(
      "Unrecorded retro schema",
    );
    expectNoWrites(conflict);
    const app = database();
    app.fail(sqlMigrations[1].up);
    await expect(applyDeveloperMigrations(app.db, new Set())).rejects.toThrow(
      "SQL details withheld",
    );
    expect(app.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    expect(app.query.mock.calls.some(([sql]) => sql.startsWith("DOWN"))).toBe(false);
    expect(app.history.has("2_second")).toBe(false);
    app.fail("");
    await applyDeveloperMigrations(app.db, new Set(["1_first"]));
    app.history.set("future", "unknown");
    app.query.mockClear();
    await expect(applyDeveloperMigrations(app.db, new Set())).rejects.toThrow(
      "Unknown local migration history",
    );
    expectNoWrites(app);
  });
  it.each([
    ["missing", "1 first Present Present"],
    ["ambiguous", "1 first Present Present\n2 second Present Present\n2 second Present Present"],
    ["dirty", "1 first Present Present\n2 second Present Dirty"],
    ["trailing dirty", "1 first Present Present\n2 second Present Present Dirty"],
    ["source missing", "1 first Present Present\n2 second Not Present Present"],
    [
      "unknown version",
      "1 first Present Present\n2 second Present Present\n3 future Not Present Present",
    ],
  ])("refuses %s CLI status before any database connection or backup", async (_name, status) => {
    effects.command.mockImplementation((file: string, args: string[]) => {
      expect(file).toBe("docker");
      if (args[0] === "ps") return "test-only";
      if (args[0] === "inspect") return JSON.stringify([service("console")]);
      expect(args.slice(0, 5)).toEqual(["exec", "test-only", "hasura-cli", "migrate", "status"]);
      expect(args).toContain("http://graphql:8080");
      return status;
    });
    await expect(applyDeveloper()).rejects.toThrow(/local CLI migration/);
    expect(effects.command.mock.calls.filter(([, args]) => args.includes("status"))).toHaveLength(
      1,
    );
    expect(effects.client).not.toHaveBeenCalled();
    expect(effects.backup).not.toHaveBeenCalled();
    expect(effects.mkdir).not.toHaveBeenCalled();
  });
  it("resolves developer emails from any domain without creating accounts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "public-id" }], rowCount: 1 });
    const db = { query } as unknown as pg.Client;
    expect(await developerAccountId(db, " Person@NHOST.IO ")).toBe("public-id");
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ["person@nhost.io"]);
    expect(await developerAccountId(db, "a@acme.local")).toBe("public-id");
    await expect(developerAccountId(db, "not-an-email@")).rejects.toThrow("valid");
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(developerAccountId(db, "missing@nhost.io")).rejects.toThrow("verify");
  });
});
