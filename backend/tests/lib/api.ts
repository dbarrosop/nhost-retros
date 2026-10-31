import { cpSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parse as toml } from "smol-toml";
import { parse as yaml } from "yaml";
import { assert, repo } from "./process.ts";
import {
  compose,
  container,
  guard,
  secrets,
  state,
  type Target,
  validateTarget,
} from "./target.ts";

export type Reply<T> = { status: number; body: T };

export async function request<T = Record<string, unknown>>(
  target: Target,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 8_000,
): Promise<Reply<T>> {
  validateTarget(target);
  const parsed = new URL(url);
  assert(
    parsed.protocol === "http:" &&
      parsed.port === `${target.httpPort}` &&
      Object.values(target.endpoints).some((base) => new URL(base).origin === parsed.origin),
    "Refused request outside registered local endpoints",
  );
  // Arbitrary local subdomains do not always resolve in public DNS. No remote DNS or redirect.
  return new Promise((resolve, reject) => {
    const req = http.request(
      parsed,
      {
        method: body === undefined ? "GET" : "POST",
        family: 4,
        lookup: (_hostname, _options, callback) => callback(null, "127.0.0.1", 4),
        headers: { "Content-Type": "application/json", ...headers },
        timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
          if (data.length > 8_000_000) req.destroy();
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: (data ? JSON.parse(data) : null) as T,
            });
          } catch {
            reject(
              new Error(`Non-JSON response from local ${parsed.hostname.split(".")[1]} service`),
            );
          }
        });
      },
    );
    req.on("error", () =>
      reject(new Error(`Local ${parsed.hostname.split(".")[1]} request failed`)),
    );
    req.on("timeout", () => req.destroy());
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

// Container health precedes Traefik registration. Retry only these harmless probes,
// never counted Auth requests or mutations; both attempts and wall time are bounded.
export async function waitForRoute(target: Target, service: "auth" | "graphql") {
  validateTarget(target);
  const deadline = performance.now() + 25_000;
  const url = service === "auth" ? `${target.endpoints.auth}/healthz` : target.endpoints.graphql;
  const body = service === "auth" ? undefined : { query: "query { __typename }" };
  const headers: Record<string, string> =
    service === "auth" ? {} : { "x-hasura-admin-secret": secrets().HASURA_GRAPHQL_ADMIN_SECRET };
  for (let attempt = 0; attempt < 10; attempt++) {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) break;
    try {
      const reply = await request<string | Record<string, unknown>>(
        target,
        url,
        body,
        headers,
        Math.min(8_000, remaining),
      );
      if (
        reply.status === 200 &&
        (service === "auth"
          ? reply.body === "OK"
          : reply.body && typeof reply.body === "object" && !reply.body.errors && !reply.body.error)
      )
        return;
    } catch {
      // A not-yet-registered route may return plain text or refuse the connection.
    }
    const delay = Math.min(1_000, deadline - performance.now());
    if (attempt < 9 && delay > 0) await setTimeout(delay);
  }
  throw new Error(`Disposable ${service} route did not become ready within bounded probes`);
}

export async function health(target: Target) {
  for (const service of ["postgres", "auth", "graphql", "constellation", "traefik"]) {
    const data = container(target, service);
    assert(
      !data.State.Health || data.State.Health.Status === "healthy",
      `Disposable ${service} is not healthy`,
    );
  }
  for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
    const result = await request(
      target,
      url,
      { query: "query { __typename }" },
      { "x-hasura-admin-secret": secrets().HASURA_GRAPHQL_ADMIN_SECRET },
    );
    assert(result.status === 200 && !result.body.errors, "GraphQL health check failed");
  }
  assertAuthConfig(target);
}

export function assertAuthConfig(target: Target) {
  const original = toml(readFileSync(join(repo, "backend/nhost/nhost.toml"), "utf8"));
  const copied = toml(readFileSync(join(state, "project/nhost/nhost.toml"), "utf8"));
  assert(
    JSON.stringify(original) === JSON.stringify(copied),
    "Disposable configuration drifted from checked-in project",
  );
  const env = Object.fromEntries(
    container(target, "auth").Config.Env.map((item) => {
      const at = item.indexOf("=");
      return [item.slice(0, at), item.slice(at + 1)];
    }),
  );
  const expected = {
    AUTH_ACCESS_CONTROL_ALLOWED_EMAIL_DOMAINS: "",
    AUTH_DISABLE_AUTO_SIGNUP: "false",
    AUTH_EMAIL_SIGNIN_EMAIL_VERIFIED_REQUIRED: "true",
    AUTH_USER_DEFAULT_ROLE: "user",
    AUTH_USER_DEFAULT_ALLOWED_ROLES: "user,me",
    AUTH_ANONYMOUS_USERS_ENABLED: "false",
    AUTH_OTP_EMAIL_ENABLED: "true",
    AUTH_RATE_LIMIT_EMAIL_BURST: "10",
    AUTH_RATE_LIMIT_BRUTE_FORCE_BURST: "10",
    AUTH_RATE_LIMIT_GLOBAL_BURST: "100",
    AUTH_RATE_LIMIT_ENABLE: "true",
  };
  for (const [key, value] of Object.entries(expected))
    assert((env[key] ?? "") === value, `Auth policy mismatch: ${key}`);
}

function included(path: string): unknown {
  const value: unknown = yaml(readFileSync(path, "utf8"));
  const expand = (item: unknown): unknown => {
    if (typeof item === "string" && item.startsWith("!include ")) {
      const next = resolve(dirname(path), item.slice(9));
      assert(
        next.startsWith(join(repo, "backend/nhost/metadata/")),
        "Metadata include escaped project",
      );
      return included(next);
    }
    if (Array.isArray(item)) return item.map(expand);
    if (item && typeof item === "object")
      return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, expand(v)]));
    return item;
  };
  return expand(value);
}

export function currentMetadata() {
  const directory = join(repo, "backend/nhost/metadata");
  const metadata: Record<string, unknown> = {
    sources: included(join(directory, "databases/databases.yaml")),
  };
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".yaml"))) {
    const value = included(join(directory, file));
    if (["actions.yaml", "version.yaml"].includes(file)) Object.assign(metadata, value);
    else if (value && (Array.isArray(value) || Object.keys(value).length > 0)) {
      metadata[file === "allow_list.yaml" ? "allowlist" : file.replace(".yaml", "")] = value;
    }
  }
  return metadata;
}

export async function synchronizeMetadata(target: Target) {
  await guard();
  const headers = { "x-hasura-admin-secret": secrets().HASURA_GRAPHQL_ADMIN_SECRET };
  const replaced = await request(
    target,
    target.endpoints.metadata,
    {
      type: "replace_metadata",
      version: 2,
      args: { allow_inconsistent_metadata: false, metadata: currentMetadata() },
    },
    headers,
  );
  assert(replaced.status === 200 && !replaced.body.error, "Current metadata could not be applied");
  const consistency = await request(
    target,
    target.endpoints.metadata,
    { type: "get_inconsistent_metadata", args: {} },
    headers,
  );
  assert(
    consistency.status === 200 &&
      consistency.body.is_consistent === true &&
      Array.isArray(consistency.body.inconsistent_objects) &&
      consistency.body.inconsistent_objects.length === 0,
    "Metadata is inconsistent",
  );
  // Constellation reads the metadata directory at startup, not Hasura's catalog.
  cpSync(join(repo, "backend/nhost/metadata"), join(state, "project/nhost/metadata"), {
    recursive: true,
  });
  await compose(target, [
    "up",
    "--detach",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
    "constellation",
  ]);
  await waitForRoute(target, "graphql");
  await health(target);
}

export type Schema = {
  data?: { __schema: { queryType: { fields: { name: string }[] } } };
  errors?: { message: string }[];
};
export async function roleSchema(
  target: Target,
  url: string,
  token: string,
  role = "user",
  allowEmptyRole = false,
) {
  const result = await request<Schema>(
    target,
    url,
    { query: "query { __schema { queryType { fields { name } } } }" },
    {
      Authorization: `Bearer ${token}`,
      "x-hasura-role": role,
    },
  );
  // Before application permissions exist, Constellation has no user schema at all.
  if (
    allowEmptyRole &&
    url === target.endpoints.graphql &&
    result.status === 200 &&
    result.body.errors?.length === 1 &&
    result.body.errors[0].message === `no schema available for role: ${role}`
  )
    return [];
  assert(
    result.status === 200 && !result.body.errors && result.body.data,
    "JWT role schema check failed",
  );
  return result.body.data.__schema.queryType.fields.map((field) => field.name);
}
