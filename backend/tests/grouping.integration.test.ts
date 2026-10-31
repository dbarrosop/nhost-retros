import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { type BoardResult, boardQuery } from "../../frontend/src/features/board/api.ts";
import { setFacilitator } from "../scripts/facilitator.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { blocked, data, denied, gql } from "./lib/retro.ts";
import { connect, guard } from "./lib/target.ts";

const addTopic = `mutation($question: uuid!, $name: String!) {
  insertRetroTopics(objects: [{questionId: $question, name: $name}]) { affected_rows returning { id name questionId createdAt } }
}`;
const renameTopic = `mutation($id: uuid!, $name: String!) {
  updateRetroTopics(where: {id: {_eq: $id}}, _set: {name: $name}) { affected_rows }
}`;
const deleteTopic = `mutation($id: uuid!) {
  deleteRetroTopics(where: {id: {_eq: $id}}) { affected_rows }
}`;
const assign = `mutation($answer: uuid!, $question: uuid!, $topic: uuid!) {
  insertRetroAnswerTopics(objects: [{answerId: $answer, questionId: $question, topicId: $topic}]) { affected_rows }
}`;
const move = `mutation($answer: uuid!, $topic: uuid!) {
  updateRetroAnswerTopics(where: {answerId: {_eq: $answer}}, _set: {topicId: $topic}) { affected_rows }
}`;
const ungroup = `mutation($answer: uuid!) {
  deleteRetroAnswerTopics(where: {answerId: {_eq: $answer}}) { affected_rows }
}`;
const board = `query($question: uuid!) {
  retroQuestions(where: {id: {_eq: $question}}) {
    id topics(order_by: [{createdAt: asc}, {id: asc}]) { id name assignments { answerId } }
    answers(order_by: [{createdAt: asc}, {id: asc}]) {
      id text authorId createdAt updatedAt author { id displayName email }
      assignment { answerId questionId topicId topic { id name } answer { id } }
    }
  }
}`;
const authors = "query { retroAnswerAuthors { id displayName email } }";
const topics = "query { retroTopics { id } }";
const assignments = "query { retroAnswerTopics { answerId } }";

async function seed(db: Client, author: string) {
  const session = (
    await db.query("INSERT INTO retro_sessions(name) VALUES('Grouping acceptance') RETURNING id")
  ).rows[0].id as string;
  const question = (
    await db.query(
      "INSERT INTO retro_questions(session_id,text) VALUES($1,'What did we learn?') RETURNING id",
      [session],
    )
  ).rows[0].id as string;
  const answer = (
    await db.query(
      "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Original private reflection') RETURNING id",
      [question, author],
    )
  ).rows[0].id as string;
  return { session, question, answer };
}

type Topic = { id: string; name: string; questionId: string; createdAt: string };
type BoardQuestion = {
  id: string;
  topics: { id: string; name: string; assignments: { answerId: string }[] }[];
  answers: {
    id: string;
    author: { id: string; displayName: string; email: string };
    assignment: null | { answerId: string; questionId: string; topicId: string };
  }[];
};
type Schema = {
  queryType: { fields: { name: string }[] };
  mutationType: { fields: { name: string }[] };
  types: { name: string; fields?: { name: string }[]; inputFields?: { name: string }[] }[];
};

describe("facilitator-only grouping and minimal author projection", () => {
  it("supports independent grouping before/after closure without participant leaks on either engine", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const alice = await actor(group),
      bob = await actor(group),
      manager = await actor(group),
      bystander = await actor(group);
    const db = await connect(target);
    try {
      await db.query("UPDATE auth.users SET display_name='Alice' WHERE id=$1", [alice.id]);
      await setFacilitator(db, manager.id, "grant");
      await manager.refresh();
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const run = (query: string, variables = {}, who = manager, role = "facilitator") =>
          gql(target, url, who, role, query, variables);
        const current = await seed(db, alice.id);
        const other = await seed(db, bob.id);
        const sibling = (
          await db.query(
            "INSERT INTO retro_questions(session_id,text) VALUES($1,'Sibling question') RETURNING id",
            [current.session],
          )
        ).rows[0].id as string;
        const add = async (question: string, name: string) => {
          const result = data(await run(addTopic, { question, name }), "insertRetroTopics") as {
            affected_rows: number;
            returning: Topic[];
          };
          expect(result.affected_rows).toBe(1);
          return result.returning[0];
        };
        const first = await add(current.question, " \uFEFFKeep\u3000 ");
        const second = await add(current.question, "Improve");
        const foreign = await add(other.question, "Other session");
        const sameSession = await add(sibling, "Other question");
        expect(first.name).toBe("Keep");
        const contents = async () =>
          (
            await db.query("SELECT * FROM retro_answers WHERE id = ANY($1::uuid[]) ORDER BY id", [
              [current.answer, other.answer],
            ])
          ).rows;
        const original = await contents();
        const readBoard = async () =>
          (
            data(
              await run(board, { question: current.question }),
              "retroQuestions",
            ) as BoardQuestion[]
          )[0];
        const assignment = async () => (await readBoard()).answers[0].assignment;
        const changed = async (
          document: string,
          variables: Record<string, unknown>,
          field: string,
        ) =>
          expect(data(await run(document, variables), field)).toMatchObject({ affected_rows: 1 });
        expect(await assignment()).toBeNull();
        // Execute the SPA's exact board projection on both engines, not a parallel test-only query.
        const boardVariables = { questionId: current.question, sessionId: current.session };
        const appBoard = data(
          await run(boardQuery, boardVariables),
          "retroQuestions",
        ) as BoardResult["retroQuestions"];
        expect(appBoard[0]?.answers[0]?.author?.id).toBe(alice.id);
        expect(appBoard[0]?.topics.map((topic) => topic.name)).toEqual(["Keep", "Improve"]);
        expect(
          data(
            await run(boardQuery, { ...boardVariables, sessionId: other.session }),
            "retroQuestions",
          ),
        ).toEqual([]);
        denied(await run(boardQuery, boardVariables, alice, "user"));
        expect((await readBoard()).answers[0].author).toEqual({
          id: alice.id,
          displayName: "Alice",
          email: alice.email,
        });
        const directory = data(await run(authors), "retroAnswerAuthors") as { id: string }[];
        expect(directory.map((a) => a.id)).toEqual(expect.arrayContaining([alice.id, bob.id]));
        expect(directory.some((a) => a.id === bystander.id || a.id === manager.id)).toBe(false);
        expect(
          data(
            await run(`query { retroAnswerAuthors(where: {id: {_eq: "${bystander.id}"}}) { id } }`),
            "retroAnswerAuthors",
          ),
        ).toEqual([]);

        for (const role of ["user", "facilitator"]) {
          const schema = data(
            await run(
              "query { __schema { queryType { fields { name } } mutationType { fields { name } } types { name fields { name } inputFields { name } } } }",
              {},
              manager,
              role,
            ),
            "__schema",
          ) as Schema;
          const fields = (name: string, input = false) =>
            (schema.types.find((t) => t.name === name)?.[input ? "inputFields" : "fields"] ?? [])
              .map((f) => f.name)
              .sort();
          for (const root of [
            "retroTopicsAggregate",
            "retroAnswerTopicsAggregate",
            "retroAnswerAuthorsAggregate",
            "users",
            "retroEligibleUsers",
          ])
            expect(schema.queryType.fields.map((f) => f.name)).not.toContain(root);
          if (role === "user") {
            for (const type of ["retroTopics", "retroAnswerTopics", "retroAnswerAuthors"])
              expect(schema.types.some((t) => t.name.startsWith(type))).toBe(false);
            expect(fields("retroQuestions")).not.toContain("topics");
            expect(fields("retroAnswers")).not.toContain("assignment");
            expect(fields("retroAnswers")).not.toContain("author");
          } else {
            expect(fields("retroAnswerAuthors")).toEqual(["answers", "displayName", "email", "id"]);
            expect(fields("retroTopics_set_input", true)).toEqual(["name"]);
            expect(fields("retroAnswerTopics_set_input", true)).toEqual(["topicId"]);
            expect(fields("retroAnswerTopics_insert_input", true)).toContain("answerId");
            expect(schema.mutationType.fields.some((f) => /RetroAnswerAuthors/.test(f.name))).toBe(
              false,
            );
          }
        }
        // No direct, nested, aggregate, relationship-filter or role-header access for participants.
        const probes: [string, Record<string, unknown>][] = [
          [topics, {}],
          [assignments, {}],
          [authors, {}],
          [board, { question: current.question }],
          ["query { retroTopicsAggregate { aggregate { count } } }", {}],
          ["query { retroQuestions { topics { id } } }", {}],
          ["query { retroAnswers { author { email } assignment { topicId } } }", {}],
          ["query { retroQuestions(where: {topics: {}}) { id } }", {}],
          [addTopic, { question: current.question, name: "Forged" }],
          [renameTopic, { id: first.id, name: "Forged" }],
          [deleteTopic, { id: first.id }],
          [assign, { answer: current.answer, question: current.question, topic: first.id }],
          [move, { answer: current.answer, topic: second.id }],
          [ungroup, { answer: current.answer }],
        ];
        for (const [query, variables] of probes) {
          denied(await run(query, variables, alice, "user"));
          denied(await run(query, variables, manager, "user"));
        }
        for (const role of ["facilitator", "me"]) denied(await run(topics, {}, alice, role));
        for (const query of [
          "query { retroTopics { assignments_aggregate { aggregate { count } } } }",
          "query { retroAnswerAuthors { answers_aggregate { aggregate { count } } } }",
          "query { retroAnswerAuthors { passwordHash metadata roles { role } } }",
          "query { users { id email } }",
        ])
          denied(await run(query));

        await changed(
          assign,
          { answer: current.answer, question: current.question, topic: first.id },
          "insertRetroAnswerTopics",
        );
        expect(await assignment()).toMatchObject({
          answerId: current.answer,
          questionId: current.question,
          topicId: first.id,
        });
        expect((await readBoard()).topics.find((t) => t.id === first.id)?.assignments).toEqual([
          { answerId: current.answer },
        ]);
        denied(
          await run(assign, {
            answer: current.answer,
            question: current.question,
            topic: second.id,
          }),
        );
        await changed(
          move,
          { answer: current.answer, topic: second.id },
          "updateRetroAnswerTopics",
        );
        expect(await assignment()).toMatchObject({ topicId: second.id });
        await changed(ungroup, { answer: current.answer }, "deleteRetroAnswerTopics");
        expect(await assignment()).toBeNull();
        for (const [question, answer, topic] of [
          [current.question, current.answer, foreign.id],
          [current.question, current.answer, sameSession.id],
          [other.question, current.answer, foreign.id],
          [current.question, other.answer, first.id],
          [randomUUID(), current.answer, first.id],
          [current.question, randomUUID(), first.id],
          [current.question, current.answer, randomUUID()],
        ])
          denied(await run(assign, { question, answer, topic }));
        expect(await assignment()).toBeNull();
        await changed(
          assign,
          { answer: current.answer, question: current.question, topic: first.id },
          "insertRetroAnswerTopics",
        );
        for (const topic of [foreign.id, sameSession.id, randomUUID()]) {
          denied(await run(move, { answer: current.answer, topic }));
          expect(await assignment()).toMatchObject({ topicId: first.id });
        }
        for (const column of ["answerId", "questionId"]) {
          denied(
            await run(
              `mutation { updateRetroAnswerTopics(where: {}, _set: {${column}: "${randomUUID()}"}) { affected_rows } }`,
            ),
          );
          denied(
            await run(
              `mutation { insertRetroAnswerTopics(objects: [{answerId: "${current.answer}", questionId: "${current.question}", topicId: "${first.id}"}], on_conflict: {constraint: retro_answer_topics_pkey, update_columns: [${column}]}) { affected_rows } }`,
            ),
          );
        }
        // Crafted upserts can only move the existing card to a topic in its immutable question.
        const upsert = (question: string, topic: string) => `mutation {
          insertRetroAnswerTopics(objects: [{answerId: "${current.answer}", questionId: "${question}", topicId: "${topic}"}],
            on_conflict: {constraint: retro_answer_topics_pkey, update_columns: [topicId]}) { affected_rows }
        }`;
        denied(await run(upsert(other.question, foreign.id)));
        expect(await assignment()).toMatchObject({
          questionId: current.question,
          topicId: first.id,
        });
        await changed(upsert(current.question, second.id), {}, "insertRetroAnswerTopics");
        denied(await run(upsert(current.question, first.id), {}, alice, "user"));
        expect(await assignment()).toMatchObject({ topicId: second.id });
        for (const column of ["id", "questionId", "createdAt"]) {
          const value = column === "createdAt" ? "2020-01-01T00:00:00Z" : randomUUID();
          denied(
            await run(
              `mutation { updateRetroTopics(where: {}, _set: {${column}: "${value}"}) { affected_rows } }`,
            ),
          );
          if (column !== "questionId")
            denied(
              await run(
                `mutation { insertRetroTopics(objects: [{questionId: "${current.question}", name: "Forged", ${column}: "${value}"}]) { affected_rows } }`,
              ),
            );
        }
        denied(
          await run(
            `mutation { insertRetroTopics(objects: [{id: "${first.id}", questionId: "${current.question}", name: "Forged"}], on_conflict: {constraint: retro_topics_pkey, update_columns: [name]}) { affected_rows } }`,
          ),
        );
        denied(
          await run(
            `mutation { insertRetroAnswerTopics(objects: [{questionId: "${current.question}", topicId: "${first.id}", answer: {data: {text: "Rewritten"}}}]) { affected_rows } }`,
          ),
        );
        for (const name of [" \uFEFF\u3000\t", "x".repeat(121), "😀".repeat(121)]) {
          denied(await run(addTopic, { question: current.question, name }));
          denied(await run(renameTopic, { id: first.id, name }));
        }
        for (const name of ["😀".repeat(120), "e\u0301".repeat(60)]) {
          await changed(renameTopic, { id: first.id, name }, "updateRetroTopics");
          expect((await readBoard()).topics.find((t) => t.id === first.id)?.name).toBe(name);
        }
        denied(await run(addTopic, { question: randomUUID(), name: "Missing parent" }));
        for (const [document, variables, field] of [
          [renameTopic, { id: randomUUID(), name: "Missing" }, "updateRetroTopics"],
          [deleteTopic, { id: randomUUID() }, "deleteRetroTopics"],
          [move, { answer: randomUUID(), topic: first.id }, "updateRetroAnswerTopics"],
          [ungroup, { answer: randomUUID() }, "deleteRetroAnswerTopics"],
        ] as const)
          denied(await run(document, variables), field);

        // Every operation checks live eligibility and membership, even with an issued JWT.
        for (const change of [
          "UPDATE auth.users SET disabled=true WHERE id=$1",
          "UPDATE auth.users SET email_verified=false WHERE id=$1",
          "UPDATE auth.users SET is_anonymous=true WHERE id=$1",
          "UPDATE auth.users SET default_role='me' WHERE id=$1",
          "DELETE FROM auth.user_roles WHERE user_id=$1 AND role='user'",
          "DELETE FROM auth.user_roles WHERE user_id=$1 AND role='facilitator'",
        ]) {
          await db.query(change, [manager.id]);
          for (const [query, field] of [
            [topics, "retroTopics"],
            [assignments, "retroAnswerTopics"],
            [authors, "retroAnswerAuthors"],
          ])
            expect(data(await run(query), field)).toEqual([]);
          expect(data(await run(board, { question: current.question }), "retroQuestions")).toEqual(
            [],
          );
          denied(await run(addTopic, { question: current.question, name: "Ineligible" }));
          denied(await run(renameTopic, { id: first.id, name: "Ineligible" }), "updateRetroTopics");
          denied(await run(deleteTopic, { id: first.id }), "deleteRetroTopics");
          denied(
            await run(assign, {
              answer: other.answer,
              question: other.question,
              topic: foreign.id,
            }),
          );
          denied(
            await run(move, { answer: current.answer, topic: first.id }),
            "updateRetroAnswerTopics",
          );
          denied(await run(ungroup, { answer: current.answer }), "deleteRetroAnswerTopics");
          denied(await run(upsert(current.question, first.id)), "insertRetroAnswerTopics");
          await db.query(
            "UPDATE auth.users SET email=$2,disabled=false,email_verified=true,is_anonymous=false,default_role='user' WHERE id=$1",
            [manager.id, manager.email],
          );
          await db.query(
            "INSERT INTO auth.user_roles(user_id,role) VALUES($1,'user'),($1,'facilitator') ON CONFLICT DO NOTHING",
            [manager.id],
          );
        }
        expect(await contents()).toEqual(original);
        await db.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [current.session]);
        await changed(renameTopic, { id: first.id, name: "After closure" }, "updateRetroTopics");
        const afterClose = await add(current.question, "Created after closure");
        await changed(
          move,
          { answer: current.answer, topic: afterClose.id },
          "updateRetroAnswerTopics",
        );
        await changed(deleteTopic, { id: afterClose.id }, "deleteRetroTopics");
        expect(await assignment()).toBeNull();
        await changed(
          assign,
          { answer: current.answer, question: current.question, topic: first.id },
          "insertRetroAnswerTopics",
        );
        await changed(upsert(current.question, second.id), {}, "insertRetroAnswerTopics");
        await changed(ungroup, { answer: current.answer }, "deleteRetroAnswerTopics");
        expect(await contents()).toEqual(original);
        // Cascades only remove grouping: active answer deletion and empty question deletion.
        await changed(
          assign,
          { answer: other.answer, question: other.question, topic: foreign.id },
          "insertRetroAnswerTopics",
        );
        expect(
          data(
            await run(
              "mutation($id: uuid!) { deleteRetroAnswers(where: {id: {_eq: $id}}) { affected_rows } }",
              { id: other.answer },
              bob,
              "user",
            ),
            "deleteRetroAnswers",
          ),
        ).toMatchObject({ affected_rows: 1 });
        expect(
          (await db.query("SELECT * FROM retro_answer_topics WHERE answer_id=$1", [other.answer]))
            .rows,
        ).toEqual([]);
        expect(
          data(
            await run(
              "mutation($id: uuid!) { deleteRetroQuestions(where: {id: {_eq: $id}}) { affected_rows } }",
              { id: other.question },
            ),
            "deleteRetroQuestions",
          ),
        ).toMatchObject({ affected_rows: 1 });
        expect(
          (await db.query("SELECT * FROM retro_topics WHERE id=$1", [foreign.id])).rows,
        ).toEqual([]);
        expect(
          data(
            await run(`query { retroAnswerAuthors(where: {id: {_eq: "${bob.id}"}}) { id } }`),
            "retroAnswerAuthors",
          ),
        ).toEqual([]);
      }
      expect(group.budget.signin).toBe(4);
      expect(group.budget.email).toBe(0);
    } finally {
      await db.end();
      for (const who of [alice, bob, manager, bystander]) await cleanupActor(target, who.id);
    }
  });

  it("keeps database grouping identities immutable without affecting answer content", async () => {
    const target = await guard();
    const author = await actor(await newGroup(target));
    const db = await connect(target);
    try {
      const { answer, question } = await seed(db, author.id);
      const topic = (
        await db.query(
          "INSERT INTO retro_topics(question_id,name) VALUES($1,'Topic') RETURNING *",
          [question],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO retro_answer_topics(answer_id,question_id,topic_id) VALUES($1,$2,$3)",
        [answer, question, topic.id],
      );
      for (const sql of [
        "UPDATE retro_topics SET id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_topics SET question_id=gen_random_uuid() WHERE id=$1",
        "UPDATE retro_topics SET created_at=now()+interval '1 day' WHERE id=$1",
      ])
        await expect(db.query(sql, [topic.id])).rejects.toThrow();
      for (const sql of [
        "UPDATE retro_answer_topics SET answer_id=gen_random_uuid() WHERE answer_id=$1",
        "UPDATE retro_answer_topics SET question_id=gen_random_uuid() WHERE answer_id=$1",
      ])
        await expect(db.query(sql, [answer])).rejects.toThrow();
      expect((await db.query("SELECT * FROM retro_topics WHERE id=$1", [topic.id])).rows).toEqual([
        topic,
      ]);
    } finally {
      await db.end();
      await cleanupActor(target, author.id);
    }
  });

  it("serializes real API moves with concurrent topic deletion and competing inserts on both engines", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const author = await actor(group),
      manager = await actor(group);
    const lock = await connect(target),
      observer = await connect(target);
    try {
      await setFacilitator(observer, manager.id, "grant");
      await manager.refresh();
      await lock.query("SET statement_timeout='8s'; SET lock_timeout='7s'");
      const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const run = (query: string, variables = {}) =>
          gql(target, url, manager, "facilitator", query, variables);
        for (const winner of ["move", "delete", "rollback-delete", "insert", "competing-move"]) {
          const current = await seed(observer, author.id);
          const topic = (
            await observer.query(
              "INSERT INTO retro_topics(question_id,name) VALUES($1,'Destination') RETURNING id",
              [current.question],
            )
          ).rows[0].id as string;
          const source = (
            await observer.query(
              "INSERT INTO retro_topics(question_id,name) VALUES($1,'Source') RETURNING id",
              [current.question],
            )
          ).rows[0].id as string;
          if (winner !== "insert")
            await observer.query(
              "INSERT INTO retro_answer_topics(answer_id,question_id,topic_id) VALUES($1,$2,$3)",
              [current.answer, current.question, source],
            );
          const before = (
            await observer.query("SELECT * FROM retro_answers WHERE id=$1", [current.answer])
          ).rows;
          await observer.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [
            current.session,
          ]);
          await lock.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          if (winner === "delete" || winner === "rollback-delete") {
            await lock.query("DELETE FROM retro_topics WHERE id=$1", [topic]);
            const writing = run(move, { answer: current.answer, topic });
            await blocked(observer, pid);
            await lock.query(winner === "delete" ? "COMMIT" : "ROLLBACK");
            if (winner === "delete") denied(await writing);
            else
              expect(data(await writing, "updateRetroAnswerTopics")).toMatchObject({
                affected_rows: 1,
              });
          } else {
            if (winner !== "insert")
              await lock.query("UPDATE retro_answer_topics SET topic_id=$2 WHERE answer_id=$1", [
                current.answer,
                topic,
              ]);
            else
              await lock.query(
                "INSERT INTO retro_answer_topics(answer_id,question_id,topic_id) VALUES($1,$2,$3)",
                [current.answer, current.question, topic],
              );
            const writing =
              winner === "move"
                ? run(deleteTopic, { id: topic })
                : winner === "insert"
                  ? run(assign, { answer: current.answer, question: current.question, topic })
                  : run(move, { answer: current.answer, topic: source });
            await blocked(observer, pid);
            await lock.query("COMMIT");
            if (winner === "move")
              expect(data(await writing, "deleteRetroTopics")).toMatchObject({ affected_rows: 1 });
            else if (winner === "insert") denied(await writing);
            else
              expect(data(await writing, "updateRetroAnswerTopics")).toMatchObject({
                affected_rows: 1,
              });
          }
          expect(
            (
              await observer.query("SELECT topic_id FROM retro_answer_topics WHERE answer_id=$1", [
                current.answer,
              ])
            ).rows,
          ).toEqual(
            winner === "move"
              ? []
              : [{ topic_id: winner === "delete" || winner === "competing-move" ? source : topic }],
          );
          expect(
            (await observer.query("SELECT * FROM retro_answers WHERE id=$1", [current.answer]))
              .rows,
          ).toEqual(before);
        }
      }
    } finally {
      await lock.query("ROLLBACK");
      await Promise.all([lock.end(), observer.end()]);
      for (const who of [author, manager]) await cleanupActor(target, who.id);
    }
  });
});
