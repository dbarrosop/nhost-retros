import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { setFacilitator } from "../scripts/facilitator.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { blocked, data, denied, gql } from "./lib/retro.ts";
import { connect, guard, type Target } from "./lib/target.ts";

const read =
  "query { retroSessions(order_by: [{createdAt: asc}, {id: asc}]) { id name ended questions { id text sessionId } } }";
const create =
  "mutation($name: String!) { insertRetroSessions(objects: [{name: $name}]) { returning { id name ended } } }";
const editSession =
  "mutation($id: uuid!, $name: String!) { updateRetroSessions(where: {id: {_eq: $id}}, _set: {name: $name}) { affected_rows } }";
const close =
  "mutation($id: uuid!) { updateRetroSessions(where: {id: {_eq: $id}}, _set: {ended: true}) { affected_rows } }";
const addQuestion =
  "mutation($id: uuid!, $text: String!) { insertRetroQuestions(objects: [{sessionId: $id, text: $text}]) { returning { id text } } }";
const editQuestion =
  "mutation($id: uuid!, $text: String!) { updateRetroQuestions(where: {id: {_eq: $id}}, _set: {text: $text}) { affected_rows } }";
const deleteQuestion =
  "mutation($id: uuid!) { deleteRetroQuestions(where: {id: {_eq: $id}}) { affected_rows } }";
const deleteSession =
  "mutation($id: uuid!) { deleteRetroSessions(where: {id: {_eq: $id}}) { affected_rows } }";
async function facilitator(target: Target) {
  const user = await actor(await newGroup(target));
  const db = await connect(target);
  try {
    await setFacilitator(db, user.id, "grant");
  } finally {
    await db.end();
  }
  await user.refresh();
  return user;
}

describe("sessions and questions through both real-JWT engines", () => {
  it("exposes only the intended schema; manages active content and irreversibly closes it", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const participant = await actor(group);
    const manager = await actor(group);
    const db = await connect(target);
    try {
      await setFacilitator(db, manager.id, "grant");
      await manager.refresh();
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const run = (query: string, variables = {}) =>
          gql(target, url, manager, "facilitator", query, variables);
        const user = (query: string, variables = {}, role = "user") =>
          gql(target, url, participant, role, query, variables);
        for (const role of ["user", "facilitator"]) {
          const schema = await gql(
            target,
            url,
            manager,
            role,
            "query { __schema { queryType { fields { name } } mutationType { fields { name } } } }",
          );
          const text = JSON.stringify(data(schema, "__schema"));
          expect(text).toContain('"retroSessions"');
          expect(text).toContain('"retroQuestions"');
          for (const forbidden of [
            "retro_eligible_users",
            "retroEligibleUsers",
            "users",
            "retroSessionsAggregate",
            "retroQuestionsAggregate",
          ])
            expect(text).not.toContain(`"${forbidden}"`);
          if (role === "user") {
            expect(text).not.toContain("insertRetroSessions");
            expect(text).not.toContain("insertRetroQuestions");
          }
        }
        for (const role of ["me", "facilitator"]) denied(await user(read, {}, role));
        denied(await user(create, { name: "Not allowed" }));
        denied(await user("query { users { id email } }"));
        const name = `API ${randomUUID()}`;
        const rows = data(
          await run(create, { name: ` \t${name}\u00a0` }),
          "insertRetroSessions",
        ) as { returning: { id: string; name: string; ended: boolean }[] };
        const session = rows.returning[0];
        expect(session.name).toBe(name);
        expect(session.ended).toBe(false);
        expect(
          data(
            await run(editSession, { id: session.id, name: `${name} renamed` }),
            "updateRetroSessions",
          ),
        ).toMatchObject({ affected_rows: 1 });
        const question = (
          data(
            await run(addQuestion, { id: session.id, text: "  What worked?\n" }),
            "insertRetroQuestions",
          ) as { returning: { id: string; text: string }[] }
        ).returning[0];
        expect(question.text).toBe("What worked?");
        expect(
          data(
            await run(editQuestion, { id: question.id, text: "What should we keep?" }),
            "updateRetroQuestions",
          ),
        ).toMatchObject({ affected_rows: 1 });
        denied(await user(editSession, { id: session.id, name: "Forged" }));
        denied(await user(addQuestion, { id: session.id, text: "Forged" }));
        denied(await user(editQuestion, { id: question.id, text: "Forged" }));
        denied(await user(deleteQuestion, { id: question.id }));
        denied(await user(deleteSession, { id: session.id }));
        denied(await run(deleteSession, { id: session.id }), "deleteRetroSessions");
        denied(
          await run(
            "mutation($id: uuid!) { updateRetroQuestions(where: {id: {_eq: $id}}, _set: {sessionId: $id}) { affected_rows } }",
            { id: question.id },
          ),
        );
        denied(
          await run(
            'mutation { insertRetroSessions(objects: [{name: "Forgery", ended: true}]) { affected_rows } }',
          ),
        );
        denied(
          await run(
            'mutation { insertRetroSessions(objects: [{name: "Forgery", createdAt: "2020-01-01T00:00:00Z"}]) { affected_rows } }',
          ),
        );
        const visible = data(await user(read), "retroSessions") as {
          id: string;
          questions: { id: string }[];
        }[];
        expect(visible.find((row) => row.id === session.id)?.questions[0].id).toBe(question.id);
        expect(
          data(
            await run(editSession, { id: randomUUID(), name: "Missing" }),
            "updateRetroSessions",
          ),
        ).toMatchObject({ affected_rows: 0 });
        denied(await run(addQuestion, { id: randomUUID(), text: "Missing parent" }));
        const temporary = (
          data(
            await run(addQuestion, { id: session.id, text: "Remove me" }),
            "insertRetroQuestions",
          ) as { returning: { id: string }[] }
        ).returning[0];
        expect(
          data(await run(deleteQuestion, { id: temporary.id }), "deleteRetroQuestions"),
        ).toMatchObject({ affected_rows: 1 });
        const empty = (
          data(await run(create, { name: "Empty session" }), "insertRetroSessions") as {
            returning: { id: string }[];
          }
        ).returning[0];
        expect(
          data(await run(deleteSession, { id: empty.id }), "deleteRetroSessions"),
        ).toMatchObject({ affected_rows: 1 });
        for (const text of ["\n\t\u00a0\uFEFF", "x".repeat(501), "😀".repeat(501)])
          denied(await run(addQuestion, { id: session.id, text }));
        for (const name of ["\u2003\t", "x".repeat(121), "😀".repeat(121)])
          denied(await run(create, { name }));
        const unicode = (
          data(
            await run(create, { name: `\uFEFF${"😀".repeat(120)}\u3000` }),
            "insertRetroSessions",
          ) as { returning: { id: string }[] }
        ).returning[0];
        expect(
          data(await run(deleteSession, { id: unicode.id }), "deleteRetroSessions"),
        ).toMatchObject({ affected_rows: 1 });
        expect(
          data(
            await run(editQuestion, { id: question.id, text: "e\u0301".repeat(250) }),
            "updateRetroQuestions",
          ),
        ).toMatchObject({ affected_rows: 1 });
        expect(data(await run(close, { id: session.id }), "updateRetroSessions")).toMatchObject({
          affected_rows: 1,
        });
        for (const [query, variables, field] of [
          [editSession, { id: session.id, name: "Changed" }, "updateRetroSessions"],
          [close, { id: session.id }, "updateRetroSessions"],
          [editQuestion, { id: question.id, text: "Changed" }, "updateRetroQuestions"],
          [deleteQuestion, { id: question.id }, "deleteRetroQuestions"],
          [deleteSession, { id: session.id }, "deleteRetroSessions"],
        ] as const)
          denied(await run(query, variables), field);
        denied(await run(addQuestion, { id: session.id, text: "Too late" }));
        denied(
          await run(
            "mutation($id: uuid!) { updateRetroSessions(where: {id: {_eq: $id}}, _set: {ended: false}) { affected_rows } }",
            { id: session.id },
          ),
          "updateRetroSessions",
        );
        expect(
          (data(await user(read), "retroSessions") as { id: string; ended: boolean }[]).find(
            (row) => row.id === session.id,
          )?.ended,
        ).toBe(true);
      }
    } finally {
      await db.end();
      await cleanupActor(target, manager.id);
      await cleanupActor(target, participant.id);
    }
  });

  it("rechecks live eligibility and trusted membership for reads and every management operation", async () => {
    const target = await guard();
    const manager = await facilitator(target);
    const db = await connect(target);
    const session = (
      await db.query("INSERT INTO retro_sessions(name) VALUES('Live eligibility') RETURNING id")
    ).rows[0].id;
    const question = (
      await db.query(
        "INSERT INTO retro_questions(session_id,text) VALUES($1,'Original') RETURNING id",
        [session],
      )
    ).rows[0].id;
    try {
      for (const [email, disabled, verified, anonymous] of [
        ["outside@example.com", false, true, false],
        ["outside@sub.nhost.io", false, true, false],
        ["outside@nhost.io.example.com", false, true, false],
        [manager.email, true, true, false],
        [manager.email, false, false, false],
        [manager.email, false, true, true],
      ]) {
        await db.query(
          "UPDATE auth.users SET email=$2,disabled=$3,email_verified=$4,is_anonymous=$5 WHERE id=$1",
          [manager.id, email, disabled, verified, anonymous],
        );
        for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
          for (const role of ["user", "facilitator"]) {
            const run = (query: string, variables = {}) =>
              gql(target, url, manager, role, query, variables);
            expect(data(await run(read), "retroSessions")).toEqual([]);
            expect(
              data(
                await run("query { retroQuestions { id session { id name } } }"),
                "retroQuestions",
              ),
            ).toEqual([]);
            denied(await run(create, { name: "Denied" }));
            denied(await run(editSession, { id: session, name: "Denied" }), "updateRetroSessions");
            denied(await run(close, { id: session }), "updateRetroSessions");
            denied(await run(addQuestion, { id: session, text: "Denied" }));
            denied(
              await run(editQuestion, { id: question, text: "Denied" }),
              "updateRetroQuestions",
            );
            denied(await run(deleteQuestion, { id: question }), "deleteRetroQuestions");
            denied(await run(deleteSession, { id: session }), "deleteRetroSessions");
          }
        }
        await db.query(
          "UPDATE auth.users SET email=$2,disabled=false,email_verified=true,is_anonymous=false WHERE id=$1",
          [manager.id, manager.email],
        );
      }
      // The pinned Auth can issue refreshed tokens after an operator email change.
      // Regardless of its policy, an issued token must not restore app access.
      await db.query("UPDATE auth.users SET email='refreshed@example.com' WHERE id=$1", [
        manager.id,
      ]);
      const refreshed = await manager.refresh();
      expect(refreshed.user.email).toBe("refreshed@example.com");
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        for (const role of ["user", "facilitator"])
          expect(data(await gql(target, url, manager, role, read), "retroSessions")).toEqual([]);
      }
      await db.query("UPDATE auth.users SET email=$2 WHERE id=$1", [manager.id, manager.email]);
      await setFacilitator(db, manager.id, "revoke");
      // Keep the granted JWT: live membership, not JWT expiry, removes privilege.
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const run = (query: string, variables = {}) =>
          gql(target, url, manager, "facilitator", query, variables);
        expect(data(await run(read), "retroSessions")).toEqual([]);
        denied(await run(create, { name: "Revoked" }));
        denied(await run(editSession, { id: session, name: "Revoked" }), "updateRetroSessions");
        denied(await run(close, { id: session }), "updateRetroSessions");
        denied(await run(addQuestion, { id: session, text: "Revoked" }));
        denied(await run(editQuestion, { id: question, text: "Revoked" }), "updateRetroQuestions");
        denied(await run(deleteQuestion, { id: question }), "deleteRetroQuestions");
        denied(await run(deleteSession, { id: session }), "deleteRetroSessions");
        expect(
          (
            data(await gql(target, url, manager, "user", read), "retroSessions") as { id: string }[]
          ).some((row) => row.id === session),
        ).toBe(true);
      }
    } finally {
      await db.query("DELETE FROM retro_questions WHERE id=$1", [question]);
      await db.query("DELETE FROM retro_sessions WHERE id=$1", [session]);
      await db.end();
      await cleanupActor(target, manager.id);
    }
  });
});

describe("READ COMMITTED closure serialization", () => {
  it("locks before reading ended for insert/update/delete, both winners and rollback", async () => {
    const target = await guard();
    const a = await connect(target),
      b = await connect(target),
      observer = await connect(target);
    try {
      for (const client of [a, b])
        await client.query("SET statement_timeout='8s'; SET lock_timeout='7s'");
      const aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      for (const operation of ["insert", "update", "delete"]) {
        for (const winner of ["write", "rollback-write", "close", "rollback-close"]) {
          const session = (
            await observer.query(
              "INSERT INTO retro_sessions(name) VALUES('Lock proof') RETURNING id",
            )
          ).rows[0].id;
          const q = (
            await observer.query(
              "INSERT INTO retro_questions(session_id,text) VALUES($1,'Before') RETURNING id",
              [session],
            )
          ).rows[0].id;
          const write = (client: Client) =>
            operation === "insert"
              ? client.query("INSERT INTO retro_questions(session_id,text) VALUES($1,'After')", [
                  session,
                ])
              : operation === "update"
                ? client.query("UPDATE retro_questions SET text='After' WHERE id=$1", [q])
                : client.query("DELETE FROM retro_questions WHERE id=$1", [q]);
          await a.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          if (winner === "write" || winner === "rollback-write") {
            await write(a);
            const closing = b.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [session]);
            await blocked(observer, aPid);
            await a.query(winner === "write" ? "COMMIT" : "ROLLBACK");
            await closing;
          } else {
            await a.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [session]);
            // Attach the rejection handler before releasing the lock.
            const writing = write(b).then(
              () => true,
              () => false,
            );
            await blocked(observer, aPid);
            await a.query(winner === "close" ? "COMMIT" : "ROLLBACK");
            expect(await writing).toBe(winner === "rollback-close");
          }
          const result = (
            await observer.query(
              "SELECT text FROM retro_questions WHERE session_id=$1 ORDER BY created_at,id",
              [session],
            )
          ).rows;
          if (winner === "close" || winner === "rollback-write")
            expect(result).toEqual([{ text: "Before" }]);
          else
            expect(result).toEqual(
              operation === "insert"
                ? [{ text: "Before" }, { text: "After" }]
                : operation === "update"
                  ? [{ text: "After" }]
                  : [],
            );
          if (winner === "rollback-close") {
            await observer.query("DELETE FROM retro_questions WHERE session_id=$1", [session]);
            await observer.query("DELETE FROM retro_sessions WHERE id=$1", [session]);
          } else {
            for (const sql of [
              "UPDATE retro_sessions SET ended=false WHERE id=$1",
              "UPDATE retro_sessions SET name='Bad' WHERE id=$1",
              "DELETE FROM retro_sessions WHERE id=$1",
            ])
              await expect(observer.query(sql, [session])).rejects.toThrow();
          }
        }
      }
      const s = (
        await observer.query(
          "INSERT INTO retro_sessions(name) VALUES('Identity proof') RETURNING id",
        )
      ).rows[0].id;
      const q = (
        await observer.query(
          "INSERT INTO retro_questions(session_id,text) VALUES($1,'Original') RETURNING id",
          [s],
        )
      ).rows[0].id;
      const whitespace =
        "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
      expect(
        (
          await observer.query("SELECT retro_trim($1) AS text, char_length($2) AS length", [
            `${whitespace}trimmed${whitespace}`,
            "😀e\u0301",
          ])
        ).rows[0],
      ).toEqual({ text: "trimmed", length: 3 });
      for (const sql of [
        "UPDATE retro_sessions SET id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_sessions SET created_at=now()+interval '1 day' WHERE id=$1",
      ])
        await expect(observer.query(sql, [s])).rejects.toThrow();
      await expect(observer.query("DELETE FROM retro_sessions WHERE id=$1", [s])).rejects.toThrow();
      await expect(
        observer.query("INSERT INTO retro_sessions(name,ended) VALUES('Already ended',true)"),
      ).rejects.toThrow();
      for (const sql of [
        "UPDATE retro_questions SET session_id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_questions SET id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_questions SET created_at=now()+interval '1 day' WHERE id=$1",
      ])
        await expect(observer.query(sql, [q])).rejects.toThrow();
      await observer.query("DELETE FROM retro_questions WHERE id=$1", [q]);
      await observer.query("DELETE FROM retro_sessions WHERE id=$1", [s]);
    } finally {
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      await Promise.all([a.end(), b.end(), observer.end()]);
    }
  });

  it("serializes actual JWT API writes/ends on each engine, independent of permission snapshots", async () => {
    const target = await guard();
    const manager = await facilitator(target);
    const lock = await connect(target),
      observer = await connect(target);
    const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    try {
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        for (const winner of ["write", "close"]) {
          const id = (
            await observer.query(
              "INSERT INTO retro_sessions(name) VALUES('API lock proof') RETURNING id",
            )
          ).rows[0].id;
          await lock.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          if (winner === "write") {
            await lock.query(
              "INSERT INTO retro_questions(session_id,text) VALUES($1,'Earlier write')",
              [id],
            );
            const closing = gql(target, url, manager, "facilitator", close, { id });
            await blocked(observer, pid);
            await lock.query("COMMIT");
            expect(data(await closing, "updateRetroSessions")).toMatchObject({ affected_rows: 1 });
          } else {
            await lock.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [id]);
            const writing = gql(target, url, manager, "facilitator", addQuestion, {
              id,
              text: "Stale write",
            });
            await blocked(observer, pid);
            await lock.query("COMMIT");
            denied(await writing);
          }
          expect(
            (
              await observer.query(
                "SELECT count(*)::int AS n FROM retro_questions WHERE session_id=$1",
                [id],
              )
            ).rows[0].n,
          ).toBe(winner === "write" ? 1 : 0);
        }
      }
    } finally {
      await lock.query("ROLLBACK");
      await Promise.all([lock.end(), observer.end()]);
      await cleanupActor(target, manager.id);
    }
  });
});
