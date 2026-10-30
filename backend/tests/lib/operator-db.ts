import pg from "pg";
import { assert } from "./process.ts";

// Explicit operator-only local SQL connection, never used by reset/test runners.
export function localOperatorOptions(value: string | undefined) {
  assert(value, "Set FACILITATOR_DATABASE_URL in the operator process environment (never VITE_*)");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid local operator database URL");
  }
  assert(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.search &&
      !url.hash,
    "Operator URL must name a loopback Postgres directly, without query overrides",
  );
  const port = Number(url.port || 5432);
  assert(
    Number.isInteger(port) && port > 0 && port <= 65535 && url.pathname.length > 1 && url.username,
    "Operator URL requires a database and SQL user",
  );
  return {
    host: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionTimeoutMillis: 5000,
    ssl: false,
  };
}
export async function connectLocalOperator() {
  const client = new pg.Client(localOperatorOptions(process.env.FACILITATOR_DATABASE_URL));
  try {
    await client.connect();
    return client;
  } catch {
    await client.end();
    throw new Error("Local operator database connection failed (details withheld)");
  }
}
