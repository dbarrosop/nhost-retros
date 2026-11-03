import { describe, expect, it } from "vitest";
import { addAnswer, deleteAnswer, editAnswer } from "../../frontend/src/features/answers/api.ts";
import {
  addTopic,
  assignAnswer,
  boardQuery,
  deleteTopic,
  moveAnswer,
  renameTopic,
  ungroupAnswer,
} from "../../frontend/src/features/board/api.ts";
import {
  addFollowUp,
  deleteFollowUp,
  editFollowUp,
  followUpSummaryQuery,
  participantFollowUpsQuery,
} from "../../frontend/src/features/follow-ups/api.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { data, denied, gql } from "./lib/retro.ts";
import { connect, guard } from "./lib/target.ts";

async function seed(db: Awaited<ReturnType<typeof connect>>, alice: string, bob: string) {
  const sessionId = (
    await db.query("INSERT INTO retro_sessions(name) VALUES('Shared after ending') RETURNING id")
  ).rows[0].id as string;
  const questionId = (
    await db.query(
      "INSERT INTO retro_questions(session_id,text) VALUES($1,'What next?') RETURNING id",
      [sessionId],
    )
  ).rows[0].id as string;
  for (const user of [alice, bob])
    await db.query(
      "INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [sessionId, user],
    );
  const answers: string[] = [];
  for (const author of [alice, bob])
    answers.push(
      (
        await db.query(
          "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'A reflection') RETURNING id",
          [questionId, author],
        )
      ).rows[0].id,
    );
  const topic = (
    await db.query(
      "INSERT INTO retro_topics(question_id,name) VALUES($1,'Shared theme') RETURNING id",
      [questionId],
    )
  ).rows[0].id as string;
  await db.query(
    "INSERT INTO retro_answer_topics(answer_id,question_id,topic_id) VALUES($1,$2,$3)",
    [answers[1], questionId, topic],
  );
  const followUp = (
    await db.query(
      "INSERT INTO retro_follow_ups(question_id,action,owner_id,ticket_url) VALUES($1,'Share the learning',$2,'https://example.com/ticket/42') RETURNING id",
      [questionId, bob],
    )
  ).rows[0].id as string;
  return { sessionId, questionId, answers, topic, followUp };
}

const allRelated = `query {
  retroAnswers { id }
  retroTopics { id assignments { answerId answer { id } } }
  retroAnswerTopics { answerId topic { id } }
  retroAnswerAuthors { id answers { id } }
  retroFollowUps { id owner { id email } }
  retroFollowUpOwners { id followUps { id } }
}`;
const byPk = `query($answer: uuid!, $topic: uuid!, $followUp: uuid!) {
  retroAnswer(id: $answer) { id author { id } assignment { topic { id } } }
  retroTopic(id: $topic) { id }
  retroAnswerTopic(answerId: $answer) { answerId }
  retroFollowUp(id: $followUp) { id owner { id } }
}`;

describe("ended-session participant reads", () => {
  it("shares all related data only with live eligible members, through root/nested/by-PK paths on both engines", async () => {
    const target = await guard(),
      group = await newGroup(target);
    const alice = await actor(group),
      bob = await actor(group),
      outsider = await actor(group);
    const db = await connect(target);
    try {
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const current = await seed(db, alice.id, bob.id);
        const active = await seed(db, alice.id, bob.id);
        const hidden = await seed(db, bob.id, outsider.id);
        await db.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [hidden.sessionId]);
        const run = (query: string, variables = {}, who = alice) =>
          gql(target, url, who, "user", query, variables);
        const vars = {
          answer: current.answers[1],
          topic: current.topic,
          followUp: current.followUp,
        };
        const invisible = async (who = alice) => {
          const result = await run(byPk, vars, who);
          expect(result.errors).toBeUndefined();
          expect(result.data).toEqual({
            retroAnswer: null,
            retroTopic: null,
            retroAnswerTopic: null,
            retroFollowUp: null,
          });
          expect(data(await run(boardQuery, current, who), "retroQuestions")).toEqual([]);
          expect(
            data(await run(participantFollowUpsQuery, current, who), "retroQuestions"),
          ).toEqual([]);
          expect(data(await run(followUpSummaryQuery, current, who), "retroSessions")).toEqual([]);
        };
        expect(data(await run(boardQuery, current), "retroQuestions")).toMatchObject([
          { topics: [], answers: [{ id: current.answers[0], author: null, assignment: null }] },
        ]);
        expect(data(await run(participantFollowUpsQuery, current), "retroQuestions")).toEqual([]);
        expect((await run(byPk, vars)).data).toEqual({
          retroAnswer: null,
          retroTopic: null,
          retroAnswerTopic: null,
          retroFollowUp: null,
        });
        // Retained former participants' contributions are included, but removal revokes their reads.
        await db.query(
          "DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2",
          [current.sessionId, bob.id],
        );
        await db.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [current.sessionId]);
        expect(data(await run(boardQuery, current), "retroQuestions")).toMatchObject([
          {
            topics: [{ id: current.topic }],
            answers: [
              { id: current.answers[0], author: { id: alice.id }, assignment: null },
              {
                id: current.answers[1],
                author: { id: bob.id },
                assignment: { topicId: current.topic },
              },
            ],
          },
        ]);
        expect(data(await run(participantFollowUpsQuery, current), "retroQuestions")).toMatchObject(
          [
            {
              followUps: [
                {
                  id: current.followUp,
                  owner: { id: bob.id, email: bob.email },
                  ticketUrl: "https://example.com/ticket/42",
                },
              ],
            },
          ],
        );
        expect(data(await run(followUpSummaryQuery, current), "retroSessions")).toMatchObject([
          { questions: [{ followUps: [{ id: current.followUp }] }] },
        ]);
        expect((await run(byPk, vars)).data).toMatchObject({
          retroAnswer: {
            id: current.answers[1],
            author: { id: bob.id },
            assignment: { topic: { id: current.topic } },
          },
          retroTopic: { id: current.topic },
          retroAnswerTopic: { answerId: current.answers[1] },
          retroFollowUp: { id: current.followUp, owner: { id: bob.id } },
        });
        const related = await run(allRelated);
        expect(related.errors).toBeUndefined();
        expect(related.data).toMatchObject({
          retroTopics: [{ id: current.topic, assignments: [{ answerId: current.answers[1] }] }],
          retroAnswerTopics: [{ answerId: current.answers[1] }],
          retroFollowUps: [{ id: current.followUp }],
          retroFollowUpOwners: [{ id: bob.id, followUps: [{ id: current.followUp }] }],
        });
        const authors = data(related, "retroAnswerAuthors") as {
          id: string;
          answers: { id: string }[];
        }[];
        // Knowing an author's identity grants no read access to their other sessions or active private cards.
        expect(authors.find((author) => author.id === bob.id)?.answers).toEqual([
          { id: current.answers[1] },
        ]);
        expect(
          (data(related, "retroAnswers") as { id: string }[]).map((answer) => answer.id).sort(),
        ).toEqual([...current.answers, active.answers[0]].sort());
        await invisible(bob);
        await invisible(outsider);
        // Late enrollment grants the same shared read access, without reopening content.
        await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
          current.sessionId,
          outsider.id,
        ]);
        expect(data(await run(boardQuery, current, outsider), "retroQuestions")).toMatchObject([
          { answers: [{ id: current.answers[0] }, { id: current.answers[1] }] },
        ]);
        expect(
          data(await run(participantFollowUpsQuery, current, outsider), "retroQuestions"),
        ).toMatchObject([{ followUps: [{ id: current.followUp, owner: { id: bob.id } }] }]);
        await db.query(
          "DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2",
          [current.sessionId, outsider.id],
        );
        await invisible(outsider);
        expect(
          data(
            await run(boardQuery, { ...current, sessionId: hidden.sessionId }),
            "retroQuestions",
          ),
        ).toEqual([]);
        // Ended read access never adds participant management or content writes.
        for (const [query, variables] of [
          [addTopic, { questionId: current.questionId, name: "Forbidden" }],
          [renameTopic, { id: current.topic, name: "Forbidden" }],
          [deleteTopic, { id: current.topic }],
          [
            assignAnswer,
            {
              answerId: current.answers[0],
              questionId: current.questionId,
              topicId: current.topic,
            },
          ],
          [moveAnswer, { answerId: current.answers[1], topicId: current.topic }],
          [ungroupAnswer, { answerId: current.answers[1] }],
          [
            addFollowUp,
            {
              questionId: current.questionId,
              action: "Forbidden",
              ownerId: alice.id,
              ticketUrl: null,
            },
          ],
          [
            editFollowUp,
            { id: current.followUp, action: "Forbidden", ownerId: alice.id, ticketUrl: null },
          ],
          [deleteFollowUp, { id: current.followUp }],
          [addAnswer, { questionId: current.questionId, text: "Frozen" }],
        ] as const)
          denied(await run(query, variables));
        denied(
          await run(editAnswer, { id: current.answers[0], text: "Frozen" }),
          "updateRetroAnswers",
        );
        denied(await run(deleteAnswer, { id: current.answers[0] }), "deleteRetroAnswers");
        for (const statement of [
          "UPDATE auth.users SET disabled=true WHERE id=$1",
          "UPDATE auth.users SET email_verified=false WHERE id=$1",
          "DELETE FROM auth.user_roles WHERE user_id=$1 AND role='user'",
        ]) {
          await db.query(statement, [alice.id]);
          await invisible();
          const deniedRelated = await run(allRelated);
          expect(deniedRelated.errors).toBeUndefined();
          for (const rows of Object.values(deniedRelated.data ?? {})) expect(rows).toEqual([]);
          await db.query("UPDATE auth.users SET disabled=false,email_verified=true WHERE id=$1", [
            alice.id,
          ]);
          await db.query(
            "INSERT INTO auth.user_roles(user_id,role) VALUES($1,'user') ON CONFLICT DO NOTHING",
            [alice.id],
          );
        }
        await db.query(
          "DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2",
          [current.sessionId, alice.id],
        );
        await invisible();
        // Avoid ended-session identity visibility contaminating the next engine's active checks.
        await db.query("DELETE FROM retro_session_participants WHERE session_id=ANY($1::uuid[])", [
          [active.sessionId, hidden.sessionId],
        ]);
      }
    } finally {
      await db.end();
      for (const who of [alice, bob, outsider]) await cleanupActor(target, who.id);
    }
  });
});
