import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  type AnswersResult,
  addAnswer,
  answersQuery,
  deleteAnswer,
  editAnswer,
} from "../../frontend/src/features/answers/api.ts";
import {
  type FacilitatorAnswersResult,
  facilitatorAnswersQuery,
} from "../../frontend/src/features/answers/facilitator-api.ts";
import { setFacilitator } from "../scripts/facilitator.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { blocked, data, denied, gql } from "./lib/retro.ts";
import { connect, guard } from "./lib/target.ts";

const close =
  "mutation($id: uuid!) { updateRetroSessions(where: {id: {_eq: $id}}, _set: {ended: true}) { affected_rows } }";
async function conversation(db: Client) {
  const session = (
    await db.query(
      "INSERT INTO retro_sessions(name) VALUES('Private cards acceptance') RETURNING id",
    )
  ).rows[0].id;
  const question = (
    await db.query(
      "INSERT INTO retro_questions(session_id,text) VALUES($1,'What did we learn?') RETURNING id",
      [session],
    )
  ).rows[0].id;
  return { session, question };
}

describe("private multiple cards and actual role-schema contracts", () => {
  it("isolates two real users, permits trusted read-all only, and freezes every API content path on both engines", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const alice = await actor(group),
      bob = await actor(group),
      manager = await actor(group);
    const db = await connect(target);
    try {
      await setFacilitator(db, manager.id, "grant");
      await manager.refresh();
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const { session, question } = await conversation(db);
        const run = (query: string, variables = {}, who = alice, role = "user") =>
          gql(target, url, who, role, query, variables);
        const mine = async (who = alice): Promise<AnswersResult["retroAnswers"]> =>
          data(
            await run(answersQuery, { questionId: question }, who),
            "retroAnswers",
          ) as AnswersResult["retroAnswers"];
        const all = async (): Promise<FacilitatorAnswersResult["retroAnswers"]> =>
          data(
            await run(facilitatorAnswersQuery, { questionId: question }, manager, "facilitator"),
            "retroAnswers",
          ) as FacilitatorAnswersResult["retroAnswers"];
        for (const role of ["user", "facilitator"]) {
          const schema = data(
            await run(
              "query { __schema { queryType { fields { name } } mutationType { fields { name } } types { name fields { name } inputFields { name } } } }",
              {},
              manager,
              role,
            ),
            "__schema",
          ) as {
            queryType: { fields: { name: string }[] };
            mutationType: { fields: { name: string }[] };
            types: {
              name: string;
              fields?: { name: string }[];
              inputFields?: { name: string }[];
            }[];
          };
          const fields = (name: string, input = false) =>
            (schema.types.find((t) => t.name === name)?.[input ? "inputFields" : "fields"] ?? [])
              .map((f) => f.name)
              .sort();
          expect(fields("retroAnswers")).toEqual(
            (role === "user"
              ? ["id", "questionId", "text", "createdAt", "updatedAt", "question"]
              : ["id", "questionId", "authorId", "text", "createdAt", "updatedAt", "question"]
            ).sort(),
          );
          expect(schema.queryType.fields.map((f) => f.name)).not.toContain("retroAnswersAggregate");
          expect(fields("retroQuestions")).not.toContain("answers_aggregate");
          if (role === "user") {
            expect(fields("retroAnswers_insert_input", true)).toEqual(["questionId", "text"]);
            expect(fields("retroAnswers_set_input", true)).toEqual(["text"]);
            expect(fields("retroAnswers_bool_exp", true)).not.toContain("authorId");
            expect(fields("retroAnswers_order_by", true)).not.toContain("authorId");
          } else {
            expect(
              schema.mutationType.fields
                .map((f) => f.name)
                .filter((n) => /(?:insert|update|delete)RetroAnswer/.test(n)),
            ).toEqual([]);
          }
        }
        for (const who of [alice, bob])
          for (const text of ["First private observation", "Second private observation"])
            expect(
              data(
                await run(addAnswer, { questionId: question, text: ` \uFEFF${text}\u3000 ` }, who),
                "insertRetroAnswers",
              ),
            ).toMatchObject({ affected_rows: 1 });
        const a = await mine(),
          b = await mine(bob);
        expect(a).toHaveLength(2);
        expect(b).toHaveLength(2);
        expect(a.map((r) => r.id).some((id) => b.some((r) => r.id === id))).toBe(false);
        expect((await all()).map((r) => r.authorId).sort()).toEqual(
          [alice.id, alice.id, bob.id, bob.id].sort(),
        );
        expect(a[0].text).toBe("First private observation");
        const nested = data(
          await run(
            "query($id: uuid!) { retroQuestions(where: {id: {_eq: $id}}) { answers { id text } session { questions { answers { id } } } } }",
            { id: question },
          ),
          "retroQuestions",
        ) as {
          answers: { id: string }[];
          session: { questions: { answers: { id: string }[] }[] };
        }[];
        expect(nested[0].answers.map((r) => r.id).sort()).toEqual(a.map((r) => r.id).sort());
        expect(
          nested[0].session.questions
            .flatMap((q) => q.answers)
            .map((r) => r.id)
            .sort(),
        ).toEqual(a.map((r) => r.id).sort());
        expect(
          data(
            await run("query($id: uuid!) { retroAnswers(where: {id: {_eq: $id}}) { id } }", {
              id: b[0].id,
            }),
            "retroAnswers",
          ),
        ).toEqual([]);
        expect(
          data(
            await run("query($id: uuid!) { retroAnswer(id: $id) { id } }", { id: b[0].id }),
            "retroAnswer",
          ),
        ).toBeNull();
        for (const query of [
          "query { retroAnswers { authorId } }",
          "query { retroAnswers { author { email } } }",
          "query { retroAnswersAggregate { aggregate { count } } }",
          "query { retroQuestions { answers_aggregate { aggregate { count } } } }",
          "query { retroAnswers { question { answers { authorId } } } }",
          "query { retroTopics { id } }",
          "query { retroAnswerAuthors { email } }",
        ])
          denied(await run(query));
        for (const role of ["me", "facilitator"])
          denied(await run(answersQuery, { questionId: question }, alice, role));
        for (const [query, field] of [
          [editAnswer, "updateRetroAnswers"],
          [deleteAnswer, "deleteRetroAnswers"],
        ]) {
          denied(
            await run(
              query,
              query === editAnswer ? { id: b[0].id, text: "Stolen" } : { id: b[0].id },
            ),
            field,
          );
          denied(
            await run(
              query,
              query === editAnswer ? { id: a[0].id, text: "Rewritten" } : { id: a[0].id },
              manager,
              "facilitator",
            ),
          );
        }
        denied(
          await run(
            addAnswer,
            { questionId: question, text: "Manager role cannot write" },
            manager,
            "facilitator",
          ),
        );
        // Trusted facilitators participate using the ordinary user role.
        data(
          await run(addAnswer, { questionId: question, text: "Manager's own card" }, manager),
          "insertRetroAnswers",
        );
        expect(await mine(manager)).toHaveLength(1);
        for (const column of ["authorId", "id", "questionId", "createdAt", "updatedAt"]) {
          const value = column.endsWith("At") ? '"2020-01-01T00:00:00Z"' : `"${bob.id}"`;
          denied(
            await run(
              `mutation { updateRetroAnswers(where: {}, _set: {${column}: ${value}}) { affected_rows } }`,
            ),
          );
          if (column !== "questionId")
            denied(
              await run(
                `mutation { insertRetroAnswers(objects: [{questionId: "${question}", text: "Forged", ${column}: ${value}}]) { affected_rows } }`,
              ),
            );
        }
        denied(
          await run(
            `mutation { insertRetroAnswers(objects: [{text: "Nested", question: {data: {sessionId: "${session}", text: "Nested question"}}}]) { affected_rows } }`,
          ),
        );
        denied(
          await run(
            `mutation { insertRetroQuestions(objects: [{sessionId: "${session}", text: "Nested", answers: {data: [{text: "Nested card"}]}}]) { affected_rows } }`,
            {},
            manager,
            "facilitator",
          ),
        );
        denied(
          await run(
            `mutation { insertRetroAnswers(objects: [{id: "${b[0].id}", questionId: "${question}", text: "Upsert theft"}], on_conflict: {constraint: retro_answers_pkey, update_columns: [text]}) { affected_rows } }`,
          ),
        );
        denied(
          await run(
            `mutation { insertRetroAnswers(objects: [{questionId: "${question}", text: "Role theft"}], on_conflict: {constraint: retro_answers_pkey, update_columns: [authorId]}) { affected_rows } }`,
          ),
        );
        // If this engine exposes ordinary upsert, a fresh generated ID can only add
        // another own card; it cannot identify or rewrite any existing card.
        await run(
          `mutation { insertRetroAnswers(objects: [{questionId: "${question}", text: "Safe upsert"}], on_conflict: {constraint: retro_answers_pkey, update_columns: [text]}) { affected_rows } }`,
        );
        expect(await mine(bob)).toEqual(b);
        for (const text of ["\t\n\uFEFF\u2003", "x".repeat(4001), "😀".repeat(4001)]) {
          denied(await run(addAnswer, { questionId: question, text }));
          denied(await run(editAnswer, { id: a[0].id, text }), "updateRetroAnswers");
        }
        for (const text of ["😀".repeat(4000), "e\u0301".repeat(2000)]) {
          data(await run(editAnswer, { id: a[0].id, text }), "updateRetroAnswers");
          expect((await mine())[0].text).toBe(text);
        }
        denied(await run(addAnswer, { questionId: randomUUID(), text: "Missing parent" }));
        const beforeBulk = await mine();
        denied(
          await run(
            `mutation($id: uuid!) { insertRetroAnswers(objects: [{questionId: $id, text: "Must roll back"}, {questionId: $id, text: "   "}]) { affected_rows } }`,
            { id: question },
          ),
        );
        expect(await mine()).toEqual(beforeBulk);
        data(
          await run(
            'mutation { updateRetroAnswers(where: {}, _set: {text: "Only mine"}) { affected_rows } }',
          ),
          "updateRetroAnswers",
        );
        expect(await mine(bob)).toEqual(b);
        expect(data(await run(deleteAnswer, { id: a[1].id }), "deleteRetroAnswers")).toMatchObject({
          affected_rows: 1,
        });
        denied(
          await run(
            "mutation($id: uuid!) { deleteRetroQuestions(where: {id: {_eq: $id}}) { affected_rows } }",
            { id: question },
            manager,
            "facilitator",
          ),
          "deleteRetroQuestions",
        );
        // Existing JWTs lose read/write access on every live eligibility change.
        for (const change of [
          "UPDATE auth.users SET email='outside@example.com' WHERE id=$1",
          "UPDATE auth.users SET email='outside@sub.nhost.io' WHERE id=$1",
          "UPDATE auth.users SET disabled=true WHERE id=$1",
          "UPDATE auth.users SET email_verified=false WHERE id=$1",
          "UPDATE auth.users SET is_anonymous=true WHERE id=$1",
          "UPDATE auth.users SET default_role='me' WHERE id=$1",
        ]) {
          await db.query(change, [alice.id]);
          expect(await mine()).toEqual([]);
          denied(await run(addAnswer, { questionId: question, text: "Ineligible" }));
          denied(await run(editAnswer, { id: a[0].id, text: "Ineligible" }), "updateRetroAnswers");
          denied(await run(deleteAnswer, { id: a[0].id }), "deleteRetroAnswers");
          await db.query(
            "UPDATE auth.users SET email=$2,disabled=false,email_verified=true,is_anonymous=false,default_role='user' WHERE id=$1",
            [alice.id, alice.email],
          );
        }
        await db.query("DELETE FROM auth.user_roles WHERE user_id=$1 AND role='user'", [alice.id]);
        expect(await mine()).toEqual([]);
        denied(await run(addAnswer, { questionId: question, text: "Missing live membership" }));
        await db.query("INSERT INTO auth.user_roles(user_id,role) VALUES($1,'user')", [alice.id]);
        await db.query("UPDATE auth.users SET disabled=true WHERE id=$1", [manager.id]);
        expect(await all()).toEqual([]);
        await db.query("UPDATE auth.users SET disabled=false WHERE id=$1", [manager.id]);
        await setFacilitator(db, manager.id, "revoke");
        expect(await all()).toEqual([]);
        await setFacilitator(db, manager.id, "grant");
        const frozen = await db.query(
          "SELECT * FROM retro_answers WHERE question_id=$1 ORDER BY id",
          [question],
        );
        data(await run(close, { id: session }, manager, "facilitator"), "updateRetroSessions");
        for (const who of [alice, bob, manager]) {
          denied(await run(addAnswer, { questionId: question, text: "Too late" }, who));
          denied(
            await run(
              `mutation($id: uuid!) { insertRetroAnswers(objects: [{questionId: $id, text: "Late one"}, {questionId: $id, text: "Late two"}]) { affected_rows } }`,
              { id: question },
              who,
            ),
          );
          denied(
            await run(
              `mutation($id: uuid!) { insertRetroAnswers(objects: [{questionId: $id, text: "Late upsert"}], on_conflict: {constraint: retro_answers_pkey, update_columns: [text]}) { affected_rows } }`,
              { id: question },
              who,
            ),
          );
          const own = (await mine(who))[0];
          for (const [document, field] of [
            [
              'mutation($id: uuid!) { updateRetroAnswer(pk_columns: {id: $id}, _set: {text: "Late by PK"}) { id } }',
              "updateRetroAnswer",
            ],
            ["mutation($id: uuid!) { deleteRetroAnswer(id: $id) { id } }", "deleteRetroAnswer"],
          ]) {
            const result = await run(document, { id: own.id }, who);
            expect(Boolean(result.errors?.length) || result.data?.[field] === null).toBe(true);
          }
          denied(
            await run(editAnswer, { id: own.id, text: "Too late" }, who),
            "updateRetroAnswers",
          );
          denied(await run(deleteAnswer, { id: own.id }, who), "deleteRetroAnswers");
          denied(
            await run(
              'mutation { updateRetroAnswers(where: {}, _set: {text: "Late bulk"}) { affected_rows } }',
              {},
              who,
            ),
            "updateRetroAnswers",
          );
          // Scope bulk delete to this closed question, not unrelated active fixtures.
          denied(
            await run(
              "mutation($id: uuid!) { deleteRetroAnswers(where: {questionId: {_eq: $id}}) { affected_rows } }",
              { id: question },
              who,
            ),
            "deleteRetroAnswers",
          );
        }
        expect(
          (
            await db.query("SELECT * FROM retro_answers WHERE question_id=$1 ORDER BY id", [
              question,
            ])
          ).rows,
        ).toEqual(frozen.rows);
        await expect(db.query("DELETE FROM auth.users WHERE id=$1", [alice.id])).rejects.toThrow();
      }
      expect(group.budget.signin).toBe(3);
      expect(group.budget.email).toBe(0);
      await cleanupActor(target, alice.id);
      expect(
        (await db.query("SELECT disabled FROM auth.users WHERE id=$1", [alice.id])).rows,
      ).toEqual([{ disabled: true }]);
      expect(
        (
          await db.query("SELECT count(*)::int AS n FROM auth.refresh_tokens WHERE user_id=$1", [
            alice.id,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query("SELECT count(*)::int AS n FROM retro_answers WHERE author_id=$1", [
            alice.id,
          ])
        ).rows[0].n,
      ).toBeGreaterThan(0);
    } finally {
      await db.end();
      for (const who of [alice, bob, manager]) await cleanupActor(target, who.id);
    }
  });
});

describe("answer closure locking", () => {
  it("serializes insert/edit/delete in both lock orders, including rollback and immutable fields", async () => {
    const target = await guard();
    const author = await actor(await newGroup(target));
    const a = await connect(target),
      b = await connect(target),
      observer = await connect(target);
    try {
      for (const db of [a, b]) await db.query("SET statement_timeout='8s'; SET lock_timeout='7s'");
      const pid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      for (const operation of ["insert", "update", "delete"])
        for (const winner of ["write", "rollback-write", "close", "rollback-close"]) {
          const { session, question } = await conversation(observer);
          const id = (
            await observer.query(
              "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Before') RETURNING id",
              [question, author.id],
            )
          ).rows[0].id;
          const write = (db: Client) =>
            operation === "insert"
              ? db.query(
                  "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'After')",
                  [question, author.id],
                )
              : operation === "update"
                ? db.query("UPDATE retro_answers SET text='After' WHERE id=$1", [id])
                : db.query("DELETE FROM retro_answers WHERE id=$1", [id]);
          await a.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          if (winner === "write" || winner === "rollback-write") {
            await write(a);
            const closing = b.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [session]);
            await blocked(observer, pid);
            await a.query(winner === "write" ? "COMMIT" : "ROLLBACK");
            await closing;
          } else {
            await a.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [session]);
            const writing = write(b).then(
              () => true,
              () => false,
            );
            await blocked(observer, pid);
            await a.query(winner === "close" ? "COMMIT" : "ROLLBACK");
            expect(await writing).toBe(winner === "rollback-close");
          }
          const result = (
            await observer.query(
              "SELECT text FROM retro_answers WHERE question_id=$1 ORDER BY created_at,id",
              [question],
            )
          ).rows;
          expect(result).toEqual(
            winner === "close" || winner === "rollback-write"
              ? [{ text: "Before" }]
              : operation === "insert"
                ? [{ text: "Before" }, { text: "After" }]
                : operation === "update"
                  ? [{ text: "After" }]
                  : [],
          );
          if (winner !== "rollback-close")
            for (const sql of [
              "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Late')",
              "UPDATE retro_answers SET text='Late' WHERE question_id=$1 AND author_id=$2",
              "DELETE FROM retro_answers WHERE question_id=$1 AND author_id=$2",
            ]) {
              // A zero-row update/delete is harmless; seed cases with retained cards
              // prove the trigger rejects every content mutation that finds a row.
              if (result.length || sql.startsWith("INSERT"))
                await expect(observer.query(sql, [question, author.id])).rejects.toThrow();
            }
        }
      const { question } = await conversation(observer);
      const id = (
        await observer.query(
          "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Before') RETURNING id",
          [question, author.id],
        )
      ).rows[0].id;
      for (const sql of [
        "UPDATE retro_answers SET id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_answers SET question_id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_answers SET author_id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_answers SET created_at=now()+interval '1 day' WHERE id=$1",
        "UPDATE retro_answers SET updated_at=now()+interval '1 day' WHERE id=$1",
      ])
        await expect(observer.query(sql, [id])).rejects.toThrow();
      await expect(
        observer.query("DELETE FROM retro_questions WHERE id=$1", [question]),
      ).rejects.toThrow();
      const before = (await observer.query("SELECT * FROM retro_answers WHERE id=$1", [id]))
        .rows[0];
      const after = (
        await observer.query(
          "UPDATE retro_answers SET text=' \uFEFFAfter\u3000 ' WHERE id=$1 RETURNING *",
          [id],
        )
      ).rows[0];
      expect(after.text).toBe("After");
      expect(after.author_id).toBe(before.author_id);
      expect(after.created_at).toEqual(before.created_at);
      expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
    } finally {
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      await Promise.all([a.end(), b.end(), observer.end()]);
      await cleanupActor(target, author.id);
    }
  });

  it("rejects actual stale JWT insert/edit/delete on both engines after close wins; earlier writes finish before API end", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const author = await actor(group),
      manager = await actor(group);
    const lock = await connect(target),
      observer = await connect(target);
    try {
      await setFacilitator(observer, manager.id, "grant");
      await manager.refresh();
      const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      for (const url of [target.endpoints.hasura, target.endpoints.graphql])
        for (const operation of ["insert", "update", "delete"])
          for (const winner of ["write", "close"]) {
            const { session, question } = await conversation(observer);
            const id = (
              await observer.query(
                "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Before') RETURNING id",
                [question, author.id],
              )
            ).rows[0].id;
            await lock.query("BEGIN ISOLATION LEVEL READ COMMITTED");
            if (winner === "write") {
              await lock.query(
                operation === "insert"
                  ? "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'After')"
                  : operation === "update"
                    ? "UPDATE retro_answers SET text='After' WHERE question_id=$1 AND author_id=$2"
                    : "DELETE FROM retro_answers WHERE question_id=$1 AND author_id=$2",
                [question, author.id],
              );
              const closing = gql(target, url, manager, "facilitator", close, { id: session });
              await blocked(observer, pid);
              await lock.query("COMMIT");
              expect(data(await closing, "updateRetroSessions")).toMatchObject({
                affected_rows: 1,
              });
            } else {
              await lock.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [session]);
              const writing = gql(
                target,
                url,
                author,
                "user",
                operation === "insert"
                  ? addAnswer
                  : operation === "update"
                    ? editAnswer
                    : deleteAnswer,
                operation === "insert"
                  ? { questionId: question, text: "Stale" }
                  : operation === "update"
                    ? { id, text: "Stale" }
                    : { id },
              );
              await blocked(observer, pid);
              await lock.query("COMMIT");
              denied(
                await writing,
                operation === "insert"
                  ? "insertRetroAnswers"
                  : operation === "update"
                    ? "updateRetroAnswers"
                    : "deleteRetroAnswers",
              );
            }
            const rows = (
              await observer.query(
                "SELECT text FROM retro_answers WHERE question_id=$1 ORDER BY created_at,id",
                [question],
              )
            ).rows;
            expect(rows).toEqual(
              winner === "close"
                ? [{ text: "Before" }]
                : operation === "insert"
                  ? [{ text: "Before" }, { text: "After" }]
                  : operation === "update"
                    ? [{ text: "After" }]
                    : [],
            );
          }
    } finally {
      await lock.query("ROLLBACK");
      await Promise.all([lock.end(), observer.end()]);
      for (const who of [author, manager]) await cleanupActor(target, who.id);
    }
  });
});
