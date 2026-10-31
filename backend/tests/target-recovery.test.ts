import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

const fake = vi.hoisted(() => ({
  repo: "",
  command: vi.fn(),
  commandAsync: vi.fn(),
  prepare: vi.fn(),
  identity: "",
}));
vi.mock("./lib/process.ts", async (original) => ({
  ...(await original<typeof import("./lib/process.ts")>()),
  repo: fake.repo,
  command: fake.command,
  commandAsync: fake.commandAsync,
}));
vi.mock("./lib/migrations.ts", () => ({
  captureBaseline: fake.prepare,
  applyMigrations: fake.prepare,
}));
vi.mock("./lib/api.ts", () => ({ synchronizeMetadata: fake.prepare }));
vi.mock("pg", () => ({
  default: {
    Client: class {
      async connect() {}
      async query() {
        return { rows: [{ id: fake.identity }] };
      }
      async end() {}
    },
  },
}));

type Runtime = typeof import("./lib/target.ts");
let runtime: Runtime;
let target: import("./lib/target.ts").Target;
let configPath: string;
let database: ReturnType<Runtime["container"]>;
let proxy: ReturnType<Runtime["container"]>;
const events: string[] = [];

function exposed(running = true) {
  for (const service of [database, proxy]) {
    service.State.Running = running;
    for (const entries of Object.values(service.HostConfig.PortBindings))
      for (const port of entries ?? []) port.HostIp = "0.0.0.0";
  }
  const config = parse(readFileSync(configPath, "utf8"));
  for (const name of ["postgres", "traefik"]) config.services[name].ports[0].host_ip = "0.0.0.0";
  writeFileSync(configPath, stringify(config));
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  events.length = 0;
  // Mock factories cache their repo export across resetModules. Reuse only this
  // suite's sandbox path, recreating its contents per test, never the real state.
  fake.repo ||= mkdtempSync(join(tmpdir(), "retro-recovery-"));
  mkdirSync(fake.repo, { recursive: true });
  runtime = await import("./lib/target.ts");
  const { state, definition, endpoints } = runtime;
  mkdirSync(join(state, "runtime"), { recursive: true, mode: 0o700 });
  mkdirSync(join(fake.repo, "backend/nhost/metadata/databases/default/tables"), {
    recursive: true,
  });
  mkdirSync(join(state, "project"));
  writeFileSync(
    join(fake.repo, "backend/nhost/metadata/databases/default/tables/tables.yaml"),
    "[]\n",
  );
  target = {
    ...definition,
    databaseId: randomUUID(),
    endpoints: endpoints(definition.subdomain, definition.httpPort),
  };
  fake.identity = target.databaseId;
  writeFileSync(join(state, "target.json"), JSON.stringify(target));
  configPath = join(state, "runtime/docker-compose.yaml");
  writeFileSync(
    configPath,
    stringify({
      services: {
        postgres: {
          ports: [{ target: 5432, published: `${target.postgresPort}` }],
          volumes: [
            {
              type: "volume",
              source: "pgdata_disposable",
              target: "/var/lib/postgresql/data/pgdata",
            },
          ],
        },
        traefik: { ports: [{ target: target.httpPort, published: `${target.httpPort}` }] },
      },
      volumes: { pgdata_disposable: {} },
    }),
  );
  const service = (name: string, port: number, published: number): typeof database => {
    const ports = { [`${port}/tcp`]: [{ HostPort: `${published}`, HostIp: "127.0.0.1" }] };
    return {
      Id: name,
      Image: "test-image",
      Config: {
        Env: [],
        Labels: {
          "com.docker.compose.project": target.project,
          "com.docker.compose.project.config_files": configPath,
        },
      },
      State: { Running: true },
      HostConfig: { PortBindings: ports },
      NetworkSettings: { Ports: ports },
      Mounts: [
        {
          Type: "volume",
          Name: `${target.project}_pgdata_disposable`,
          Source: "test-volume",
          Destination: "/var/lib/postgresql/data/pgdata",
        },
      ],
    };
  };
  database = service("postgres", 5432, target.postgresPort);
  proxy = service("traefik", target.httpPort, target.httpPort);
  fake.command.mockImplementation((file: string, args: string[]) => {
    if (file === "nhost" && args[0] === "--version") return "nhost 1.51.2";
    if (file === "docker" && args[0] === "context")
      return JSON.stringify([
        { Name: "default", Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
      ]);
    if (file === "docker" && args[0] === "ps")
      return args.some((arg) => arg.endsWith("service=postgres")) ? "postgres" : "traefik";
    if (file === "docker" && args[0] === "inspect")
      return JSON.stringify([args[1] === "postgres" ? database : proxy]);
    if (file === "docker" && args[0] === "exec") {
      events.push("identity");
      return fake.identity;
    }
    throw new Error("Unexpected fake command");
  });
  fake.commandAsync.mockImplementation(async (file: string) => {
    if (file === "nhost") {
      events.push("nhost");
      exposed();
      return "";
    }
    events.push("compose");
    const config = parse(readFileSync(configPath, "utf8"));
    // The correction must precede EVERY Compose startup, including stopped DB resume.
    for (const name of ["postgres", "traefik"])
      expect(config.services[name].ports[0].host_ip).toBe("127.0.0.1");
    for (const container of [database, proxy]) {
      container.State.Running = true;
      for (const ports of Object.values(container.HostConfig.PortBindings))
        for (const port of ports ?? []) port.HostIp = "127.0.0.1";
    }
    return "";
  });
});

afterEach(() => {
  rmSync(fake.repo, { recursive: true, force: true });
});

describe("registered partial-provision recovery", () => {
  it.each([true, false])(
    "repairs a public runtime before resuming (running=%s)",
    async (running) => {
      exposed(running);
      await runtime.provision();
      expect(events.indexOf("compose")).toBeLessThan(events.indexOf("nhost"));
      expect(events.filter((event) => event === "compose")).toHaveLength(3);
      expect(fake.prepare).toHaveBeenCalledTimes(3);
      expect(existsSync(join(runtime.state, "run.lock"))).toBe(false);
      await expect(runtime.guard()).resolves.toMatchObject({ databaseId: target.databaseId });
      const before = readFileSync(configPath, "utf8");
      await runtime.repairRuntime(target);
      expect(readFileSync(configPath, "utf8")).toBe(before);
    },
  );

  it("repairs CLI failure bindings, releases the lock and permits a later guarded resume", async () => {
    const implementation = fake.commandAsync.getMockImplementation();
    if (!implementation) throw new Error("Missing fake command implementation");
    fake.commandAsync.mockImplementation(async (file, ...args) => {
      if (file === "nhost") {
        exposed();
        throw new Error("nhost failed (timeout); output withheld");
      }
      return implementation?.(file, ...args);
    });
    await expect(runtime.provision()).rejects.toThrow("timeout");
    expect(existsSync(join(runtime.state, "run.lock"))).toBe(false);
    expect(fake.prepare).not.toHaveBeenCalled();
    await expect(runtime.guard()).resolves.toMatchObject({ databaseId: target.databaseId });
    fake.commandAsync.mockImplementation(implementation);
    await runtime.provision();
    expect(fake.prepare).toHaveBeenCalledTimes(3);
  });

  it.each(["identity", "labels", "volume", "ports"])(
    "refuses mismatched %s before mutation",
    async (mismatch) => {
      exposed();
      if (mismatch === "identity") fake.identity = randomUUID();
      if (mismatch === "labels") database.Config.Labels["com.docker.compose.project"] = "backend";
      if (mismatch === "volume") {
        const config = parse(readFileSync(configPath, "utf8"));
        config.volumes.pgdata_disposable.name = "backend_pgdata";
        writeFileSync(configPath, stringify(config));
      }
      if (mismatch === "ports")
        database.HostConfig.PortBindings["5432/tcp"] = [{ HostIp: "0.0.0.0", HostPort: "5432" }];
      const before = readFileSync(configPath, "utf8");
      await expect(runtime.provision()).rejects.toThrow(/mismatch|Unregistered/);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      expect(fake.commandAsync).not.toHaveBeenCalled();
      expect(fake.prepare).not.toHaveBeenCalled();
      expect(existsSync(join(runtime.state, "run.lock"))).toBe(false);
    },
  );

  it("releases the provisioning lock after an actual bounded slow subprocess", async () => {
    const { commandAsync } =
      await vi.importActual<typeof import("./lib/process.ts")>("./lib/process.ts");
    await expect(
      runtime.locked(async () => {
        await commandAsync(
          process.execPath,
          ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
          { timeoutMs: 500, killGraceMs: 50 },
        );
      }),
    ).rejects.toThrow("timeout");
    expect(existsSync(join(runtime.state, "run.lock"))).toBe(false);
    await expect(runtime.locked(async () => {})).resolves.toBeUndefined();
  });
});
