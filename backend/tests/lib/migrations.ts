import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeIdentifier } from "pg";
import { assert, command, repo } from "./process.ts";
import { connect, container, guard, psql, state, type Target } from "./target.ts";

export function migrations() {
  const directory = join(repo, "backend/nhost/migrations/default");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .map((file) => {
      assert(/^\d+_[a-z0-9_]+$/.test(file.name), "Unexpected migration directory name");
      const sql = (direction: string) =>
        readFileSync(join(directory, file.name, `${direction}.sql`), "utf8");
      return { name: file.name, up: sql("up"), down: sql("down") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function dump(target: Target, database: string, authOnly = false) {
  const args = [
    "exec",
    container(target, "postgres").Id,
    "pg_dump",
    "-U",
    "postgres",
    "--schema-only",
    "--no-owner",
    "--no-privileges",
  ];
  if (authOnly) args.push("--schema=auth");
  return command("docker", [...args, database]);
}

function normalized(dump: string) {
  return dump
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("\\restrict ") &&
        !line.startsWith("\\unrestrict ") &&
        !line.startsWith("--"),
    )
    .join("\n")
    .trim();
}

type Baseline = {
  databaseId: string;
  postgresImage: string;
  authImage: string;
  schema: string;
  roles: { role: string }[];
  extensions: { extname: string; extversion: string }[];
};
const baselineFile = join(state, "auth-baseline.json");

export async function captureBaseline(target: Target) {
  await guard();
  if (existsSync(baselineFile)) {
    readBaseline(target);
    return;
  }
  const source = await connect(target);
  try {
    const ledger = await source.query("SELECT to_regclass('retro_test_guard.migrations') AS name");
    if (ledger.rows[0].name)
      assert(
        (await source.query("SELECT count(*)::int AS count FROM retro_test_guard.migrations"))
          .rows[0].count === 0,
        "Cannot capture an already-migrated Auth baseline",
      );
    const baseline: Baseline = {
      databaseId: target.databaseId,
      postgresImage: container(target, "postgres").Image,
      authImage: container(target, "auth").Image,
      schema: dump(target, target.database, true),
      roles: (await source.query("SELECT role FROM auth.roles ORDER BY role")).rows,
      extensions: (
        await source.query(
          "SELECT extname,extversion FROM pg_extension WHERE extname IN ('citext','pgcrypto') ORDER BY extname",
        )
      ).rows,
    };
    assert(
      baseline.schema.includes("CREATE TABLE auth.users") && baseline.extensions.length === 2,
      "Pinned Auth baseline is incomplete",
    );
    writeFileSync(baselineFile, JSON.stringify(baseline), { mode: 0o600, flag: "wx" });
  } finally {
    await source.end();
  }
}

function readBaseline(target: Target): Baseline {
  assert(
    existsSync(baselineFile),
    "Missing pinned Auth baseline; provision the disposable target first",
  );
  const baseline: Baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  assert(
    baseline.databaseId === target.databaseId &&
      baseline.postgresImage === container(target, "postgres").Image &&
      baseline.authImage === container(target, "auth").Image,
    "Pinned baseline image/database mismatch; provision a fresh disposable stack after version changes",
  );
  return baseline;
}

export async function scratchDatabase(target: Target, action: (name: string) => Promise<void>) {
  await guard();
  const name = `retro_scratch_${randomBytes(10).toString("hex")}`;
  assert(/^retro_scratch_[a-f0-9]{20}$/.test(name), "Unsafe scratch database name");
  const source = await connect(target);
  try {
    // Identifiers cannot be SQL parameters: random allowlisted name + pg identifier quoting.
    await source.query(`CREATE DATABASE ${escapeIdentifier(name)} TEMPLATE template0`);
    try {
      await action(name);
    } finally {
      await source.query(`DROP DATABASE ${escapeIdentifier(name)} WITH (FORCE)`);
    }
    const remaining = await source.query("SELECT datname FROM pg_database WHERE datname = $1", [
      name,
    ]);
    assert(remaining.rowCount === 0, "Scratch database cleanup failed");
  } finally {
    await source.end();
  }
}

export async function migrationRoundtrip(target: Target) {
  const baseline = readBaseline(target);
  try {
    await scratchDatabase(target, async (name) => {
      psql(target, "CREATE EXTENSION citext; CREATE EXTENSION pgcrypto;", name);
      psql(target, baseline.schema, name);
      const scratch = await connect(target, name);
      try {
        const extensions = (
          await scratch.query(
            "SELECT extname,extversion FROM pg_extension WHERE extname IN ('citext','pgcrypto') ORDER BY extname",
          )
        ).rows;
        assert(
          JSON.stringify(extensions) === JSON.stringify(baseline.extensions),
          "Migration baseline extension versions differ",
        );
        for (const { role } of baseline.roles)
          await scratch.query("INSERT INTO auth.roles(role) VALUES ($1)", [role]);
        const before = normalized(dump(target, name));
        const roleRows = async () =>
          (await scratch.query("SELECT role FROM auth.roles ORDER BY role")).rows;
        const beforeRoles = JSON.stringify(await roleRows());
        const all = migrations();
        for (const migration of all) await scratch.query(migration.up);
        const after = normalized(dump(target, name));
        for (const migration of [...all].reverse()) await scratch.query(migration.down);
        assert(
          normalized(dump(target, name)) === before,
          "Migration down did not restore pinned Auth/schema baseline",
        );
        assert(
          JSON.stringify(await roleRows()) === beforeRoles,
          "Migration down did not restore baseline Auth roles",
        );
        for (const migration of all) await scratch.query(migration.up);
        assert(normalized(dump(target, name)) === after, "Migration reapply changed schema");
        console.log(
          `Scratch Auth baseline/up/down/up passed (${all.length} application migrations)`,
        );
      } finally {
        await scratch.end();
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Migration")) throw error;
    throw new Error("Scratch migration/baseline check failed (SQL details withheld)");
  }
}

export async function applyMigrations(target: Target) {
  await guard();
  const db = await connect(target);
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS retro_test_guard.migrations(name text PRIMARY KEY, checksum text NOT NULL)",
    );
    await db.query(
      "ALTER TABLE retro_test_guard.migrations ADD COLUMN IF NOT EXISTS checksum text",
    );
    for (const migration of migrations()) {
      const checksum = createHash("sha256")
        .update(JSON.stringify([migration.up, migration.down]))
        .digest("hex");
      const applied = await db.query(
        "SELECT checksum FROM retro_test_guard.migrations WHERE name=$1",
        [migration.name],
      );
      if (applied.rowCount) {
        assert(
          applied.rows[0].checksum === checksum,
          `Changed applied migration: ${migration.name}; provision a fresh disposable target`,
        );
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(migration.up);
        await db.query("INSERT INTO retro_test_guard.migrations(name,checksum) VALUES ($1,$2)", [
          migration.name,
          checksum,
        ]);
        await db.query("COMMIT");
      } catch {
        await db.query("ROLLBACK");
        throw new Error(`Application migration failed: ${migration.name} (SQL details withheld)`);
      }
    }
  } finally {
    await db.end();
  }
}
