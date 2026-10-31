import type { Client } from "pg";
import { expect } from "vitest";
import { request } from "./api.ts";
import type { Actor } from "./auth.ts";
import type { Target } from "./target.ts";

export type Result = { data?: Record<string, unknown>; errors?: unknown[] };
export async function gql(
  target: Target,
  url: string,
  user: Actor,
  role: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const reply = await request<Result>(
    target,
    url,
    { query, variables },
    {
      Authorization: `Bearer ${user.session.accessToken}`,
      "x-hasura-role": role,
    },
  );
  return reply.status >= 400 ? { errors: ["HTTP denial"] } : reply.body;
}
export function data(result: Result, field: string): unknown {
  expect(result.errors, "GraphQL operation must succeed").toBeUndefined();
  expect(result.data).toBeTruthy();
  return result.data?.[field];
}
export function denied(result: Result, field?: string) {
  if (result.errors?.length) return;
  expect(field && result.data?.[field]).toMatchObject({ affected_rows: 0 });
}
export async function blocked(observer: Client, blocker: number) {
  await expect
    .poll(
      async () =>
        (
          await observer.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
            [blocker],
          )
        ).rows[0].n,
      { timeout: 4_000, interval: 20 },
    )
    .toBeGreaterThan(0);
}
