import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repo } from "./lib/process.ts";
import { connect, guard } from "./lib/target.ts";

const seed = readFileSync(
  join(repo, "backend/nhost/seeds/default/20261106000000_demo_retros.sql"),
  "utf8",
);
const id = (kind: number, n: number) =>
  `acde${kind}000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: pg.Client;

beforeEach(async () => {
  db = await connect(await guard());
  await db.query("BEGIN");
});
afterEach(async () => {
  if (db) {
    await db.query("ROLLBACK");
    await db.end();
  }
});

async function snapshot() {
  return {
    users: (
      await db.query(
        "SELECT id,email,display_name,locale,default_role,email_verified,disabled,is_anonymous FROM auth.users WHERE id::text LIKE 'acde0000-0000-4000-8000-%' ORDER BY id",
      )
    ).rows,
    roles: (
      await db.query(
        "SELECT user_id,role FROM auth.user_roles WHERE user_id::text LIKE 'acde0000-0000-4000-8000-%' ORDER BY user_id,role",
      )
    ).rows,
    sessions: (
      await db.query(
        "SELECT * FROM retro_sessions WHERE id::text LIKE 'acde1000-0000-4000-8000-%' ORDER BY id",
      )
    ).rows,
    participants: (
      await db.query(
        "SELECT * FROM retro_session_participants WHERE session_id::text LIKE 'acde1000-0000-4000-8000-%' ORDER BY session_id,user_id",
      )
    ).rows,
    questions: (
      await db.query(
        "SELECT * FROM retro_questions WHERE id::text LIKE 'acde2000-0000-4000-8000-%' ORDER BY id",
      )
    ).rows,
    answers: (
      await db.query(
        "SELECT * FROM retro_answers WHERE id::text LIKE 'acde3000-0000-4000-8000-%' ORDER BY id",
      )
    ).rows,
    topics: (
      await db.query(
        "SELECT * FROM retro_topics WHERE id::text LIKE 'acde4000-0000-4000-8000-%' ORDER BY id",
      )
    ).rows,
    assignments: (
      await db.query(
        "SELECT * FROM retro_answer_topics WHERE answer_id::text LIKE 'acde3000-0000-4000-8000-%' ORDER BY answer_id",
      )
    ).rows,
  };
}

describe("local retrospective demo seed", () => {
  it("creates verified least-privilege accounts and a coherent active/ended board dataset", async () => {
    await db.query(seed);
    const data = await snapshot();
    expect(data.users).toHaveLength(9);
    expect(data.roles).toHaveLength(19);
    expect(data.sessions).toHaveLength(3);
    expect(data.participants).toHaveLength(27);
    expect(data.questions).toHaveLength(9);
    expect(data.answers).toHaveLength(72);
    expect(data.topics).toHaveLength(19);
    expect(data.assignments).toHaveLength(54);
    expect(data.sessions.filter((session) => session.ended)).toHaveLength(1);
    for (const user of data.users) {
      expect(user).toMatchObject({
        email_verified: true,
        disabled: false,
        is_anonymous: false,
        default_role: "user",
        locale: "en",
      });
      expect(
        data.roles
          .filter((role) => role.user_id === user.id)
          .map((role) => role.role)
          .sort(),
      ).toEqual(user.id === id(0, 1) ? ["facilitator", "me", "user"] : ["me", "user"]);
    }
    expect(data.users.find((user) => user.id === id(0, 1))?.email).toBe("factilitator@acme.local");
    expect(
      (
        await db.query(
          "SELECT id,is_facilitator FROM retro_eligible_users WHERE id::text LIKE 'acde0000-0000-4000-8000-%'",
        )
      ).rows,
    ).toHaveLength(9);
    expect(
      (await db.query("SELECT is_facilitator FROM retro_eligible_users WHERE id=$1", [id(0, 1)]))
        .rows,
    ).toEqual([{ is_facilitator: true }]);
    for (const question of data.questions) {
      const cards = data.answers.filter((answer) => answer.question_id === question.id);
      expect(cards).toHaveLength(8);
      expect(
        data.assignments.filter((assignment) => assignment.question_id === question.id),
      ).toHaveLength(6);
    }
    for (const assignment of data.assignments) {
      expect(data.answers.find((answer) => answer.id === assignment.answer_id)?.question_id).toBe(
        assignment.question_id,
      );
      expect(data.topics.find((topic) => topic.id === assignment.topic_id)?.question_id).toBe(
        assignment.question_id,
      );
    }
    await db.query("SAVEPOINT frozen");
    await expect(
      db.query("UPDATE retro_answers SET text='Cannot rewrite history' WHERE id=$1", [id(3, 1)]),
    ).rejects.toThrow("Ended sessions are immutable");
    await db.query("ROLLBACK TO SAVEPOINT frozen");
    // Grouping is deliberately still editable after closure.
    await db.query("UPDATE retro_topics SET name='Historical theme' WHERE id=$1", [id(4, 1)]);
  });

  it("replays without duplicating data, overwriting edits or restoring a revoked grant", async () => {
    await db.query(seed);
    const initial = await snapshot();
    await db.query(seed);
    expect(await snapshot()).toEqual(initial);

    await db.query("UPDATE retro_answers SET text='My edited reflection' WHERE id=$1", [id(3, 25)]);
    await db.query("UPDATE retro_topics SET name='My renamed topic' WHERE id=$1", [id(4, 7)]);
    await db.query("UPDATE retro_answer_topics SET topic_id=$2 WHERE answer_id=$1", [
      id(3, 25),
      id(4, 8),
    ]);
    await db.query(
      "UPDATE auth.users SET display_name='Renamed account',disabled=true WHERE id=$1",
      [id(0, 2)],
    );
    await db.query("DELETE FROM auth.user_roles WHERE user_id=$1 AND role='facilitator'", [
      id(0, 1),
    ]);
    await db.query("DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2", [
      id(1, 1),
      id(0, 2),
    ]);
    const edited = await snapshot();
    await db.query(seed);
    expect(await snapshot()).toEqual(edited);
  });

  it("fails atomically if a demo account ID belongs to another email", async () => {
    await db.query(
      "INSERT INTO auth.users(id,email,locale,default_role) VALUES($1,'existing@example.com','en','user')",
      [id(0, 2)],
    );
    const before = await snapshot();
    await db.query("SAVEPOINT collision");
    await expect(db.query(seed)).rejects.toThrow("Demo account ID belongs to a different email");
    await db.query("ROLLBACK TO SAVEPOINT collision");
    expect(await snapshot()).toEqual(before);
  });
});
