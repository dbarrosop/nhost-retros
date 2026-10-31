import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { currentMetadata } from "./api.ts";
import { migrations } from "./migrations.ts";
import { assert, command, repo } from "./process.ts";
import { localDocker } from "./target.ts";

const composeFile = join(repo, "backend/.nhost/docker-compose.yaml");
export const developerComposeArgs = [
  "compose",
  "--project-name",
  "backend",
  "--project-directory",
  join(repo, "backend"),
  "--file",
  composeFile,
];
type Service = {
  Id: string;
  Config: { Labels: Record<string, string>; Env: string[] };
  State: { Running: boolean };
  Mounts: { Type: string; Source: string; Destination: string }[];
  NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> };
};

// This is NOT a disposable Target. There is deliberately no reset/down operation.
export function validateDeveloperService(data: Service, service: string) {
  assert(
    data.Config.Labels["com.docker.compose.project"] === "backend" &&
      data.Config.Labels["com.docker.compose.service"] === service &&
      data.Config.Labels["com.docker.compose.project.config_files"] === composeFile &&
      data.State.Running,
    "Expected this repository's running developer backend; no remote/project overrides allowed",
  );
  if (service === "postgres" || service === "traefik") {
    const port = service === "postgres" ? "5432" : "443";
    assert(
      data.NetworkSettings.Ports[`${port}/tcp`]?.some((p) => p.HostPort === port),
      "Developer port mismatch; refusing local apply",
    );
  }
  if (service === "constellation")
    assert(
      data.Mounts.some(
        (m) =>
          m.Type === "bind" &&
          m.Destination === "/metadata" &&
          m.Source === join(repo, "backend/nhost/metadata"),
      ),
      "Developer Constellation must mount this repository's metadata",
    );
  return data;
}
export function developerService(service: string): Service {
  localDocker();
  assert(realpathSync(composeFile) === composeFile, "Refused symlinked developer Compose file");
  const ids = command("docker", [
    "ps",
    "-q",
    "--filter",
    "label=com.docker.compose.project=backend",
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  assert(ids.length === 1, `Missing/ambiguous developer ${service} service`);
  return validateDeveloperService(JSON.parse(command("docker", ["inspect", ids[0]]))[0], service);
}
function environment(service: Service) {
  return Object.fromEntries(
    service.Config.Env.map((value) => {
      const at = value.indexOf("=");
      return [value.slice(0, at), value.slice(at + 1)];
    }),
  );
}
export async function connectDeveloper() {
  const postgres = developerService("postgres");
  developerService("traefik");
  const env = environment(postgres);
  assert(
    env.POSTGRES_USER === "postgres" && env.POSTGRES_DB === "local" && env.POSTGRES_PASSWORD,
    "Unexpected developer database configuration",
  );
  const db = new pg.Client({
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    database: "local",
    password: env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    const sql =
      "SELECT system_identifier::text || ':' || current_database() AS identity FROM pg_control_system()";
    const identity = command(
      "docker",
      [
        "exec",
        "-i",
        postgres.Id,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "local",
        "-At",
      ],
      sql,
    ).trim();
    assert(
      (await db.query(sql)).rows[0].identity === identity,
      "Developer network/database identity mismatch",
    );
    return db;
  } catch {
    await db.end();
    throw new Error("Verified developer database connection failed (details withheld)");
  }
}

export async function developerAccountId(db: pg.Client, value: string) {
  if (!value.includes("@")) return value;
  const email = value.trim().toLowerCase();
  assert(/^[^\s@]+@nhost\.io$/.test(email), "Use an exact @nhost.io developer account");
  const result = await db.query("SELECT id FROM auth.users WHERE lower(email::text)=$1", [email]);
  assert(result.rowCount === 1, "Create and verify this developer account by OTP first");
  return result.rows[0].id as string;
}

const urls = {
  metadata: "https://local.hasura.local.nhost.run/v1/metadata",
  hasura: "https://local.hasura.local.nhost.run/v1/graphql",
  graphql: "https://local.graphql.local.nhost.run/v1",
};
async function api(
  service: keyof typeof urls,
  body: unknown,
  role?: string,
): Promise<Record<string, unknown>> {
  const secret = environment(developerService("graphql")).HASURA_GRAPHQL_ADMIN_SECRET;
  assert(secret, "Developer GraphQL admin credential unavailable");
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`Developer ${service} request failed (details withheld)`));
    const request = https.request(
      urls[service],
      {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        family: 4,
        lookup: (_host, _options, callback) => callback(null, "127.0.0.1", 4),
        headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": secret,
          ...(role ? { "x-hasura-role": role } : {}),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
          if (text.length > 8_000_000) request.destroy();
        });
        response.on("end", () => {
          try {
            const value = JSON.parse(text);
            if (response.statusCode !== 200 || value.errors || value.error) return fail();
            resolve(value);
          } catch {
            fail();
          }
        });
      },
    );
    request.on("error", fail);
    request.end(JSON.stringify(body));
  });
}

type Metadata = {
  sources: {
    name: string;
    tables: { table: { schema: string; name: string } }[];
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};
export function mergeRetroMetadata(existing: Metadata, checkedIn: Metadata): Metadata {
  const source = checkedIn.sources.find((s) => s.name === "default");
  assert(
    source && existing.sources.some((s) => s.name === "default"),
    "Missing default metadata source",
  );
  const retro = (table: { table: { schema: string; name: string } }) =>
    table.table.schema === "public" && table.table.name.startsWith("retro_");
  return {
    ...existing,
    sources: existing.sources.map((s) =>
      s.name !== "default"
        ? s
        : {
            ...s,
            tables: [...s.tables.filter((t) => !retro(t)), ...source.tables.filter(retro)],
          },
    ),
  };
}

export async function applyDeveloperMigrations(db: pg.Client, cliApplied: ReadonlySet<string>) {
  const ledger = (await db.query("SELECT to_regclass('retro_local_operations.migrations') AS name"))
    .rows[0].name;
  const all = migrations().map((migration) => ({
    ...migration,
    checksum: createHash("sha256")
      .update(JSON.stringify([migration.up, migration.down]))
      .digest("hex"),
  }));
  const history = ledger
    ? (await db.query("SELECT name,checksum FROM retro_local_operations.migrations")).rows
    : [];
  assert(
    [...history.map((row) => row.name), ...cliApplied].every((name) =>
      all.some((migration) => migration.name === name),
    ),
    "Unknown local migration history; use a compatible revision, never reset",
  );
  const recorded = new Map(history.map((row) => [row.name, row.checksum]));
  // Validate the entire history before any DDL, transaction or backfill can run.
  // nhost up may have executed SQL without recording our verified checksum.
  for (const migration of all) {
    if (recorded.has(migration.name))
      assert(
        recorded.get(migration.name) === migration.checksum,
        "Changed applied local migration; use a reviewed forward migration, never reset",
      );
    else
      assert(
        !cliApplied.has(migration.name),
        "CLI-applied local migration lacks a verified checksum; reconcile explicitly with a protected backup, never adopt or replay",
      );
  }
  if (!ledger) {
    const existing = await db.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'retro\\_%' UNION ALL SELECT 1 FROM auth.roles WHERE role='facilitator' LIMIT 1",
    );
    assert(
      existing.rowCount === 0,
      "Unrecorded retro schema/role exists; reconcile history explicitly, never reset",
    );
    await db.query(
      "CREATE SCHEMA IF NOT EXISTS retro_local_operations; CREATE TABLE IF NOT EXISTS retro_local_operations.migrations(name text PRIMARY KEY, checksum text NOT NULL)",
    );
  }
  for (const migration of all) {
    if (recorded.has(migration.name)) continue;
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
      await db.query(migration.up);
      await db.query("INSERT INTO retro_local_operations.migrations(name,checksum) VALUES($1,$2)", [
        migration.name,
        migration.checksum,
      ]);
      await db.query("COMMIT");
    } catch {
      await db.query("ROLLBACK");
      throw new Error(`Additive local migration failed: ${migration.name}; SQL details withheld`);
    }
  }
}

export function developerCliApplied(output: string, version: string) {
  assert(/^\d+$/.test(version), "Invalid local CLI migration version");
  const lines = output.split("\n").filter((line) => line.trim().split(/\s+/)[0] === version);
  assert(lines.length === 1, "Missing/ambiguous local CLI migration status");
  const status = lines[0].match(
    /^\s*\d+\s+\S+\s+(Present|Not Present)\s+(Present|Not Present)\s*$/,
  );
  assert(status && status[1] === "Present", "Unrecognized local CLI migration status");
  return status[2] === "Present";
}

export function developerCliHistory(output: string) {
  const all = migrations();
  const versions = new Set(all.map((migration) => migration.name.split("_")[0]));
  const reported = output.split("\n").map((line) => line.trim().split(/\s+/)[0]);
  assert(
    reported.every((version) => !/^\d+$/.test(version) || versions.has(version)),
    "Unknown local CLI migration history; use a compatible revision, never reset",
  );
  return new Set(
    all
      .filter((migration) => developerCliApplied(output, migration.name.split("_")[0]))
      .map((migration) => migration.name),
  );
}

function developerMigrationCli() {
  const consoleService = developerService("console");
  return (args: string[]) =>
    command("docker", [
      "exec",
      consoleService.Id,
      "hasura-cli",
      "migrate",
      ...args,
      "--database-name",
      "default",
      "--endpoint",
      "http://graphql:8080",
      "--skip-update-check",
    ]);
}

function synchronizeCliHistory(cli: (args: string[]) => string, cliApplied: ReadonlySet<string>) {
  const missing = migrations().filter((migration) => !cliApplied.has(migration.name));
  for (const migration of missing) {
    // SQL is already committed with a verified checksum. Only mirror CLI state;
    // ordinary nhost up must not try to execute the same migration a second time.
    cli(["apply", "--version", migration.name.split("_")[0], "--skip-execution"]);
  }
  if (missing.length) {
    const after = developerCliHistory(cli(["status"]));
    assert(after.size === migrations().length, "Could not mirror local CLI migration state");
  }
}

export async function applyDeveloper() {
  // Read and parse CLI state once before connecting or backing up. Missing,
  // ambiguous or dirty status must never reach migration SQL or ledger writes.
  const cli = developerMigrationCli();
  const cliApplied = developerCliHistory(cli(["status"]));
  const db = await connectDeveloper();
  try {
    assert(
      (await db.query("SELECT pg_try_advisory_lock(hashtext('nhost-retro-local-apply')) AS locked"))
        .rows[0].locked,
      "Another developer apply owns the migration lock",
    );
    developerService("constellation");
    const exported = await api("metadata", { type: "export_metadata", version: 2, args: {} });
    assert(
      exported.metadata && Number.isInteger(exported.resource_version),
      "Invalid developer metadata export",
    );
    const backup = join(repo, "backend/.nhost/retro-backups", `${Date.now()}-${process.pid}`);
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    const file = openSync(join(backup, "database.sql"), "wx", 0o600);
    try {
      // Stream potentially large/private dumps directly to a restricted file.
      execFileSync(
        "docker",
        [
          "exec",
          developerService("postgres").Id,
          "pg_dump",
          "-U",
          "postgres",
          "--no-owner",
          "--no-privileges",
          "local",
        ],
        {
          cwd: repo,
          stdio: ["ignore", file, "pipe"],
          timeout: 120_000,
        },
      );
    } catch {
      throw new Error(
        "Developer database backup failed; no migration attempted (details withheld)",
      );
    } finally {
      closeSync(file);
    }
    writeFileSync(join(backup, "metadata.json"), JSON.stringify(exported.metadata), {
      mode: 0o600,
      flag: "wx",
    });
    await applyDeveloperMigrations(db, cliApplied);
    const metadata = mergeRetroMetadata(
      exported.metadata as Metadata,
      currentMetadata() as Metadata,
    );
    await api("metadata", {
      type: "replace_metadata",
      version: 2,
      resource_version: exported.resource_version,
      args: { allow_inconsistent_metadata: false, metadata },
    });
    const consistency = await api("metadata", { type: "get_inconsistent_metadata", args: {} });
    assert(
      consistency.is_consistent === true &&
        Array.isArray(consistency.inconsistent_objects) &&
        consistency.inconsistent_objects.length === 0,
      "Developer metadata is inconsistent",
    );
    command(
      "docker",
      [
        ...developerComposeArgs,
        "up",
        "--detach",
        "--no-deps",
        "--force-recreate",
        "--wait",
        "--wait-timeout",
        "60",
        "constellation",
      ],
      undefined,
      120_000,
    );
    let ready = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await api("graphql", { query: "query { __typename }" });
        ready = true;
        break;
      } catch {
        if (attempt < 9) await setTimeout(1000);
      }
    }
    assert(ready, "Developer Constellation route did not become ready");
    for (const engine of ["hasura", "graphql"] as const)
      for (const role of ["user", "facilitator"]) {
        const schema = await api(
          engine,
          { query: "query { __schema { queryType { fields { name } } } }" },
          role,
        );
        const names = JSON.stringify(schema);
        assert(
          names.includes('"retroSessions"') &&
            names.includes('"retroAnswers"') &&
            (role !== "facilitator" || names.includes('"retroTopics"')),
          "Developer role schema is incomplete",
        );
      }
    synchronizeCliHistory(cli, cliApplied);
    console.log(
      "Developer app migrations/metadata and CLI history ready on both engines; existing data retained. Restricted backup: backend/.nhost/retro-backups/",
    );
  } finally {
    await db.end();
  }
}
