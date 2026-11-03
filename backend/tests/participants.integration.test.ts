import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addAnswer,
  answersQuery,
  deleteAnswer,
  editAnswer,
} from "../../frontend/src/features/answers/api.ts";
import { boardQuery } from "../../frontend/src/features/board/api.ts";
import {
  addParticipant,
  participantsQuery,
  removeParticipant,
} from "../../frontend/src/features/sessions/participants-api.ts";
import { setFacilitator } from "../scripts/facilitator.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { migrations } from "./lib/migrations.ts";
import { blocked, data, denied, gql } from "./lib/retro.ts";
import { connect, guard } from "./lib/target.ts";

const read = `query($id: uuid!, $question: uuid!) {
  retroSessions(where: {id: {_eq: $id}}) { id questions { id } participants { userId } }
  retroSession(id: $id) { id }
  retroQuestions(where: {id: {_eq: $question}}) { id session { id } }
  retroQuestion(id: $question) { id }
}`;

describe("explicit session participants", () => {
  it("leaves existing sessions and authors unenrolled on migration", async () => {
    const db = await connect(await guard());
    const migration = migrations().find((m) => m.name.endsWith("_retro_participants"));
    if (!migration) throw new Error("Missing participant migration");
    try {
      await db.query("BEGIN");
      await db.query(migration.down);
      const author = (
        await db.query(
          "INSERT INTO auth.users(email,locale,default_role) VALUES($1,'en','user') RETURNING id",
          [`${randomUUID()}@example.com`],
        )
      ).rows[0].id;
      const session = (
        await db.query(
          "INSERT INTO retro_sessions(name) VALUES('Existing conversation') RETURNING id",
        )
      ).rows[0].id;
      const question = (
        await db.query(
          "INSERT INTO retro_questions(session_id,text) VALUES($1,'Existing question') RETURNING id",
          [session],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Existing response')",
        [question, author],
      );
      await db.query(migration.up);
      expect((await db.query("SELECT * FROM retro_session_participants")).rows).toEqual([]);
      expect(
        (await db.query("SELECT text FROM retro_answers WHERE question_id=$1", [question])).rows,
      ).toEqual([{ text: "Existing response" }]);
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  });
  it("requires facilitator enrollment for direct/nested reads and every answer write on both engines", async () => {
    const target = await guard(),
      group = await newGroup(target);
    const alice = await actor(group),
      bob = await actor(group),
      manager = await actor(group);
    const db = await connect(target);
    try {
      await setFacilitator(db, manager.id, "grant");
      await manager.refresh();
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const sessionId = (
          await db.query(
            "INSERT INTO retro_sessions(name) VALUES('Participant access') RETURNING id",
          )
        ).rows[0].id;
        const questionId = (
          await db.query(
            "INSERT INTO retro_questions(session_id,text) VALUES($1,'Private question') RETURNING id",
            [sessionId],
          )
        ).rows[0].id;
        const variables = { sessionId, userId: alice.id };
        const user = (query: string, vars = {}, who = alice) =>
          gql(target, url, who, "user", query, vars);
        const manage = (query: string, vars = {}) =>
          gql(target, url, manager, "facilitator", query, vars);
        const invisible = async () => {
          const result = await user(read, { id: sessionId, question: questionId });
          expect(result.errors).toBeUndefined();
          expect(result.data).toMatchObject({
            retroSessions: [],
            retroSession: null,
            retroQuestions: [],
            retroQuestion: null,
          });
          expect(
            data(await user(answersQuery, { questionId, authorId: alice.id }), "retroAnswers"),
          ).toEqual([]);
          denied(await user(addAnswer, { questionId, text: "Not enrolled" }));
        };
        await invisible();
        denied(await user(addParticipant, variables));
        denied(await user(removeParticipant, variables));
        denied(await user("query { retroParticipantAccounts { id email } }"));
        denied(await user("query { retroSessionParticipants { account { email } } }"));
        denied(await user(addAnswer, { questionId, text: "Facilitator must enroll too" }, manager));
        expect(
          data(await manage(addParticipant, variables), "insertRetroSessionParticipants"),
        ).toMatchObject({ affected_rows: 1 });
        denied(await manage(addParticipant, variables));
        expect(
          data(await user(read, { id: sessionId, question: questionId }), "retroSession"),
        ).toMatchObject({ id: sessionId });
        data(
          await user(addAnswer, { questionId, text: "Retained reflection" }),
          "insertRetroAnswers",
        );
        const answer = (
          data(await user(answersQuery, { questionId, authorId: alice.id }), "retroAnswers") as {
            id: string;
          }[]
        )[0];
        expect(
          data(await user(read, { id: sessionId, question: questionId }, bob), "retroSessions"),
        ).toEqual([]);
        // Cross-session membership grants no access to this question.
        const other = (
          await db.query("INSERT INTO retro_sessions(name) VALUES('Other membership') RETURNING id")
        ).rows[0].id;
        await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
          other,
          bob.id,
        ]);
        denied(await user(addAnswer, { questionId, text: "Wrong session" }, bob));
        // A disabled target cannot be enrolled, even with a stale directory choice.
        await db.query("UPDATE auth.users SET disabled=true WHERE id=$1", [bob.id]);
        denied(await manage(addParticipant, { sessionId, userId: bob.id }));
        await db.query("UPDATE auth.users SET disabled=false WHERE id=$1", [bob.id]);
        const roster = data(await manage(participantsQuery, { sessionId }), "retroSessions") as {
          participants: { userId: string }[];
        }[];
        expect(roster[0].participants.map((p) => p.userId)).toEqual([alice.id]);
        expect(
          data(await manage(removeParticipant, variables), "deleteRetroSessionParticipants"),
        ).toMatchObject({ affected_rows: 1 });
        await invisible();
        denied(await user(editAnswer, { id: answer.id, text: "Removed" }), "updateRetroAnswers");
        denied(await user(deleteAnswer, { id: answer.id }), "deleteRetroAnswers");
        const board = data(
          await manage(boardQuery, { questionId, sessionId }),
          "retroQuestions",
        ) as { answers: { id: string }[] }[];
        expect(board[0].answers.map((a) => a.id)).toEqual([answer.id]);
        // Enrollment is also allowed for ended sessions, without reopening content.
        await db.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [sessionId]);
        data(await manage(addParticipant, variables), "insertRetroSessionParticipants");
        expect(
          data(await user(answersQuery, { questionId, authorId: alice.id }), "retroAnswers"),
        ).toHaveLength(1);
        denied(await user(addAnswer, { questionId, text: "Ended" }));
        await db.query("DELETE FROM auth.user_roles WHERE user_id=$1 AND role='facilitator'", [
          manager.id,
        ]);
        denied(await manage(removeParticipant, variables), "deleteRetroSessionParticipants");
        denied(await manage(addParticipant, { sessionId, userId: bob.id }));
        expect(
          data(await manage(participantsQuery, { sessionId }), "retroParticipantAccounts"),
        ).toEqual([]);
        await setFacilitator(db, manager.id, "grant");
      }
    } finally {
      await db.end();
      for (const who of [alice, bob, manager]) await cleanupActor(target, who.id);
    }
  });

  it("serializes participant removal against stale API insert/edit/delete snapshots", async () => {
    const target = await guard();
    const author = await actor(await newGroup(target));
    const lock = await connect(target),
      db = await connect(target);
    try {
      const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        for (const operation of ["insert", "update", "delete"]) {
          const sessionId = (
            await db.query("INSERT INTO retro_sessions(name) VALUES('Removal lock') RETURNING id")
          ).rows[0].id;
          const questionId = (
            await db.query(
              "INSERT INTO retro_questions(session_id,text) VALUES($1,'Question') RETURNING id",
              [sessionId],
            )
          ).rows[0].id;
          await db.query(
            "INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)",
            [sessionId, author.id],
          );
          const id = (
            await db.query(
              "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'Retained') RETURNING id",
              [questionId, author.id],
            )
          ).rows[0].id;
          await lock.query("BEGIN");
          await lock.query(
            "DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2",
            [sessionId, author.id],
          );
          const writing = gql(
            target,
            url,
            author,
            "user",
            operation === "insert" ? addAnswer : operation === "update" ? editAnswer : deleteAnswer,
            operation === "insert"
              ? { questionId, text: "Stale" }
              : operation === "update"
                ? { id, text: "Stale" }
                : { id },
          );
          await blocked(db, pid);
          await lock.query("COMMIT");
          denied(
            await writing,
            operation === "insert"
              ? "insertRetroAnswers"
              : operation === "update"
                ? "updateRetroAnswers"
                : "deleteRetroAnswers",
          );
          expect((await db.query("SELECT text FROM retro_answers WHERE id=$1", [id])).rows).toEqual(
            [{ text: "Retained" }],
          );
        }
      }
    } finally {
      await lock.query("ROLLBACK");
      await Promise.all([lock.end(), db.end()]);
      await cleanupActor(target, author.id);
    }
  });
});
