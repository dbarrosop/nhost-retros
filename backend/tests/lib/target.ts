import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import pg from "pg";
import { parse, stringify } from "smol-toml";
import { parse as yaml, stringify as yamlStringify } from "yaml";
import { assert, command, repo } from "./process.ts";

export const state = join(repo, ".local-test");
const suffix = createHash("sha256").update(repo).digest("hex").slice(0, 8);
export const definition = {
  version: 1,
  disposable: true,
  repository: repo,
  project: `retro-test-${suffix}`,
  subdomain: `retrotest${suffix}`,
  state,
  httpPort: 18080,
  postgresPort: 55432,
  database: "local",
};
export type Target = typeof definition & {
  databaseId: string;
  endpoints: ReturnType<typeof endpoints>;
};

export function endpoints(subdomain: string, port: number) {
  const base = (service: string) => `http://${subdomain}.${service}.local.nhost.run:${port}`;
  return {
    auth: `${base("auth")}/v1`,
    hasura: `${base("hasura")}/v1/graphql`,
    graphql: `${base("graphql")}/v1`,
    metadata: `${base("hasura")}/v1/metadata`,
    mail: base("mailhog"),
  };
}

export function validateTarget(value: unknown): Target {
  assert(value && typeof value === "object", "Disposable target marker missing or invalid");
  const target = value as Target;
  for (const [key, expected] of Object.entries(definition)) {
    assert(target[key as keyof Target] === expected, `Refused mismatched target: ${key}`);
  }
  assert(/^[0-9a-f-]{36}$/.test(target.databaseId), "Invalid target database identity");
  assert(
    JSON.stringify(target.endpoints) ===
      JSON.stringify(endpoints(target.subdomain, target.httpPort)),
    "Refused remote or mismatched endpoint",
  );
  return target;
}

export function loadTarget(markerPath = join(state, "target.json")): Target {
  assert(existsSync(markerPath), "No registered disposable target; run pnpm test:target provision");
  assert(realpathSync(state) === state, "Refused symlinked target state");
  assert(
    (statSync(state).mode & 0o077) === 0,
    "Disposable state must be permission-restricted (0700)",
  );
  try {
    return validateTarget(JSON.parse(readFileSync(markerPath, "utf8")));
  } catch {
    throw new Error("Refused invalid/mismatched disposable target marker");
  }
}

export function validateDockerHost(contextHost: unknown, environmentHost?: string) {
  for (const host of [contextHost, environmentHost].filter((value) => value !== undefined)) {
    assert(
      typeof host === "string" && host.startsWith("unix:///"),
      "Refused non-local Docker daemon",
    );
  }
  assert(typeof contextHost === "string", "Missing Docker context endpoint");
}

export function localDocker() {
  const context = JSON.parse(command("docker", ["context", "inspect"]));
  validateDockerHost(context[0]?.Endpoints?.docker?.Host, process.env.DOCKER_HOST);
  assert(
    !process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === context[0]?.Name,
    "Docker context mismatch",
  );
}

type Container = {
  Id: string;
  Image: string;
  Config: { Labels: Record<string, string>; Env: string[] };
  State: { Running: boolean; Health?: { Status: string } };
  NetworkSettings: { Ports: Record<string, { HostPort: string; HostIp: string }[] | null> };
  Mounts: { Source: string; Destination: string; Type: string; Name?: string }[];
};

export function container(target: Target, service: string, running = true): Container {
  validateTarget(target);
  localDocker();
  const ids = command("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${target.project}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  assert(ids.length === 1, `Required disposable ${service} service is missing/ambiguous`);
  const data: Container = JSON.parse(command("docker", ["inspect", ids[0]]))[0];
  const labels = data.Config.Labels;
  assert(labels["com.docker.compose.project"] === target.project, "Docker project mismatch");
  assert(
    labels["com.docker.compose.project.config_files"] ===
      join(state, "runtime", "docker-compose.yaml"),
    "Unregistered compose file",
  );
  if (running) assert(data.State.Running, `Required disposable ${service} service is stopped`);
  return data;
}

export function secrets(): Record<string, string> {
  const path = join(state, "project", ".secrets");
  assert((statSync(path).mode & 0o077) === 0, "Test credentials must have mode 0600");
  return parse(readFileSync(path, "utf8")) as Record<string, string>;
}

export function compose(target: Target, args: string[]) {
  validateTarget(target);
  localDocker();
  return command(
    "docker",
    [
      "compose",
      "--project-name",
      target.project,
      "--file",
      join(state, "runtime", "docker-compose.yaml"),
      ...args,
    ],
    undefined,
    240_000,
  );
}

export function psql(target: Target, sql: string, database = target.database) {
  const db = container(target, "postgres");
  return command(
    "docker",
    [
      "exec",
      "-i",
      db.Id,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
      "-At",
    ],
    sql,
  );
}

export async function connect(target: Target, database = target.database) {
  validateTarget(target);
  assert(
    database === target.database || /^retro_scratch_[a-f0-9]{20}$/.test(database),
    "Refused unregistered database name",
  );
  const client = new pg.Client({
    host: "127.0.0.1",
    port: target.postgresPort,
    user: "postgres",
    password: "postgres",
    database,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end();
    throw new Error("Disposable Postgres connection failed");
  }
}

async function guardDatabase(target: Target) {
  const postgres = container(target, "postgres");
  assert(
    postgres.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort === `${target.postgresPort}`,
    "Postgres port mismatch",
  );
  assert(
    postgres.NetworkSettings.Ports["5432/tcp"]?.every((port) => port.HostIp === "127.0.0.1"),
    "Disposable database must bind only to loopback",
  );
  assert(
    postgres.Mounts.some((m) => m.Type === "volume" && m.Name?.startsWith(`${target.project}_`)),
    "Unregistered database volume",
  );
  const identity = psql(target, "SELECT id FROM retro_test_guard.identity;").trim();
  assert(
    identity === target.databaseId,
    "Database identity mismatch; refusing destructive operation",
  );
  const client = await connect(target);
  try {
    const result = await client.query("SELECT id FROM retro_test_guard.identity");
    assert(
      result.rows.length === 1 && result.rows[0].id === target.databaseId,
      "Network database identity mismatch",
    );
  } finally {
    await client.end();
  }
}

export async function guard(markerPath?: string): Promise<Target> {
  const target = loadTarget(markerPath);
  await guardDatabase(target);
  const traefik = container(target, "traefik");
  assert(
    traefik.NetworkSettings.Ports[`${target.httpPort}/tcp`]?.[0]?.HostPort === `${target.httpPort}`,
    "HTTP port mismatch",
  );
  assert(
    traefik.NetworkSettings.Ports[`${target.httpPort}/tcp`]?.every(
      (port) => port.HostIp === "127.0.0.1",
    ),
    "Disposable HTTP must bind only to loopback",
  );
  return target;
}

export async function freePort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Required local port ${port} is occupied`)));
    server.listen({ host: "::", port, ipv6Only: false }, () => server.close(() => resolve()));
  });
}

export async function locked(action: () => Promise<void>) {
  assert(existsSync(state), "Provision the disposable test target first");
  const path = join(state, "run.lock");
  try {
    writeFileSync(path, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  } catch {
    throw new Error(
      "Another test runner owns .local-test/run.lock; do not run Auth groups concurrently",
    );
  }
  try {
    await action();
  } finally {
    rmSync(path);
  }
}

function syncConfig() {
  const destination = join(state, "project", "nhost");
  // Copy the checked-in project, never generate default config or copy developer data/secrets.
  // Keep bind-mounted directory inodes alive when resuming a running stack.
  cpSync(join(repo, "backend", "nhost"), destination, { recursive: true });
  // Bootstrap Auth before app SQL/metadata, so baseline roles never include app grants.
  rmSync(join(destination, "migrations"), { recursive: true, force: true });
  rmSync(join(destination, "seeds"), { recursive: true, force: true });
  const tables = join(destination, "metadata/databases/default/tables");
  const includes = yaml(readFileSync(join(tables, "tables.yaml"), "utf8")) as string[];
  const baseline = includes.filter((item) => {
    const file = item.replace("!include ", "");
    assert(/^[a-z0-9_]+\.yaml$/.test(file), "Unexpected bootstrap metadata include");
    const data = yaml(readFileSync(join(tables, file), "utf8"));
    return ["auth", "storage"].includes(data.table.schema);
  });
  writeFileSync(join(tables, "tables.yaml"), yamlStringify(baseline));
}

async function prepare(target: Target) {
  const { captureBaseline, applyMigrations } = await import("./migrations.ts");
  const { synchronizeMetadata } = await import("./api.ts");
  await captureBaseline(target);
  await applyMigrations(target);
  await synchronizeMetadata(target);
}

export async function provision() {
  localDocker();
  assert(
    command("nhost", ["--version"]).includes("1.51.2"),
    "This runner requires Nhost CLI 1.51.2",
  );
  if (existsSync(join(state, "target.json"))) {
    const target = loadTarget();
    await locked(async () => {
      // Resume only the reserved DB if stopped, then verify identity BEFORE Auth/metadata changes.
      const postgres = container(target, "postgres", false);
      container(target, "traefik", false);
      if (!postgres.State.Running)
        compose(target, [
          "up",
          "--detach",
          "--no-deps",
          "--wait",
          "--wait-timeout",
          "60",
          "postgres",
        ]);
      await guardDatabase(target);
      syncConfig();
      start(target);
      await guard();
      await prepare(target);
    });
    return;
  }
  assert(
    !existsSync(state),
    "Unregistered .local-test exists; preserve/inspect it before provisioning",
  );
  assert(
    !command("docker", [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${definition.project}`,
    ]).trim(),
    "Disposable project name already exists without registration",
  );
  await freePort(definition.httpPort);
  await freePort(definition.postgresPort);
  mkdirSync(join(state, "project"), { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  const target: Target = {
    ...definition,
    databaseId: randomUUID(),
    endpoints: endpoints(definition.subdomain, definition.httpPort),
  };
  writeFileSync(join(state, "provisioning.json"), JSON.stringify(target), { mode: 0o600 });
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const random = () => randomBytes(32).toString("hex");
  const values = {
    GRAFANA_ADMIN_PASSWORD: random(),
    HASURA_GRAPHQL_ADMIN_SECRET: random(),
    NHOST_JWT_KID: randomUUID(),
    NHOST_JWT_PRIVATE_KEY: keys.privateKey,
    NHOST_JWT_PUBLIC_KEY: keys.publicKey,
    NHOST_WEBHOOK_SECRET: random(),
  };
  writeFileSync(join(state, "project", ".secrets"), stringify(values), { mode: 0o600 });
  syncConfig();
  start(target);
  // Only this new, reserved project is registerable; no developer-stack opt-in/inference.
  psql(
    target,
    `CREATE SCHEMA retro_test_guard; CREATE TABLE retro_test_guard.identity(id uuid PRIMARY KEY); INSERT INTO retro_test_guard.identity VALUES ('${target.databaseId}');`,
  );
  writeFileSync(join(state, "target.json"), JSON.stringify(target, null, 2), { mode: 0o600 });
  rmSync(join(state, "provisioning.json"));
  await guard();
  await locked(async () => prepare(target));
}

function start(target: Target) {
  command(
    "nhost",
    [
      "--root-folder",
      join(state, "project"),
      "--nhost-folder",
      join(state, "project", "nhost"),
      "--dot-nhost-folder",
      join(state, "runtime"),
      "--project-name",
      definition.project,
      "--local-subdomain",
      definition.subdomain,
      "--branch",
      "disposable",
      "up",
      "--disable-tls",
      "--http-port",
      `${definition.httpPort}`,
      "--postgres-port",
      `${definition.postgresPort}`,
      "--down-on-error",
    ],
    undefined,
    300_000,
  );
  // nhost 1.51.2 may return zero after an up error. Health/identity are checked independently.
  const path = join(state, "runtime/docker-compose.yaml");
  const config = yaml(readFileSync(path, "utf8"));
  for (const service of Object.values(config.services) as { ports?: { host_ip?: string }[] }[]) {
    for (const port of service.ports ?? []) port.host_ip = "127.0.0.1";
  }
  writeFileSync(path, yamlStringify(config), { mode: 0o600 });
  compose(target, ["up", "--detach", "--wait", "--wait-timeout", "120"]);
}
