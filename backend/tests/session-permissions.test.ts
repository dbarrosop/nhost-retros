import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { repo } from "./lib/process.ts";

type Permission = {
  columns?: string[];
  filter?: unknown;
  check?: unknown;
  allow_aggregations?: boolean;
};
type Table = Record<string, { role: string; permission: Permission }[]>;
const table = (name: string) =>
  parse(
    readFileSync(
      join(repo, `backend/nhost/metadata/databases/default/tables/public_${name}.yaml`),
      "utf8",
    ),
  ) as Table;
const permission = (name: string, operation = "select") =>
  table(name)[`${operation}_permissions`]?.find((entry) => entry.role === "user")?.permission;
const eligible = {
  _exists: {
    _table: { name: "retro_eligible_users", schema: "public" },
    _where: { id: { _eq: "X-Hasura-User-Id" } },
  },
};
const member = { participants: { user_id: { _eq: "X-Hasura-User-Id" } } };
const ended = { ended: { _eq: true }, ...member };

describe("ended-session permission metadata contracts", () => {
  it.each([
    ["retro_topics", { question: { session: ended } }],
    ["retro_answer_topics", { answer: { question: { session: ended } } }],
    ["retro_answer_authors", { answers: { question: { session: ended } } }],
    ["retro_follow_ups", { question: { session: ended } }],
    ["retro_follow_up_owners", { followUps: { question: { session: ended } } }],
  ])("gates every %s read by ended state, enrollment and live eligibility", (name, related) => {
    const select = permission(name as string);
    expect(select?.filter).toEqual({ _and: [eligible, related] });
    expect(select?.allow_aggregations).not.toBe(true);
    for (const operation of ["insert", "update", "delete"])
      expect(permission(name as string, operation)).toBeUndefined();
  });

  it("keeps enrollment and eligibility mandatory when answers become shared", () => {
    expect(permission("retro_answers")?.filter).toEqual({
      _and: [
        { question: { session: member } },
        {
          _or: [
            { author_id: { _eq: "X-Hasura-User-Id" } },
            { question: { session: { ended: { _eq: true } } } },
          ],
        },
        eligible,
      ],
    });
    expect(permission("retro_answers")?.columns).toContain("author_id");
    // Neither authors nor outcomes expose the broader account picker or Auth secrets.
    for (const name of ["retro_answer_authors", "retro_follow_up_owners"])
      expect(permission(name)?.columns).toEqual(["id", "display_name", "email"]);
    expect(permission("retro_participant_accounts")).toBeUndefined();
    expect(permission("retro_eligible_users")).toBeUndefined();
  });
});
