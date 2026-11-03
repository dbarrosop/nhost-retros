import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addFollowUp,
  deleteFollowUp,
  editFollowUp,
  type FollowUpsResult,
  followUpSummaryQuery,
  followUpsQuery,
  participantFollowUpsQuery,
} from "../../frontend/src/features/follow-ups/api.ts";
import { setFacilitator } from "../scripts/facilitator.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { blocked, data, denied, gql } from "./lib/retro.ts";
import { connect, guard } from "./lib/target.ts";

async function seed(db: Awaited<ReturnType<typeof connect>>, owner: string) {
  const sessionId = (
    await db.query("INSERT INTO retro_sessions(name) VALUES('Follow-up acceptance') RETURNING id")
  ).rows[0].id as string;
  const questionId = (
    await db.query(
      "INSERT INTO retro_questions(session_id,text) VALUES($1,'What should change?') RETURNING id",
      [sessionId],
    )
  ).rows[0].id as string;
  await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
    sessionId,
    owner,
  ]);
  return { sessionId, questionId };
}

describe("facilitator-managed question follow-ups", () => {
  it("validates actions/owners/links, preserves ownership after removal and supports post-end CRUD on both engines", async () => {
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
        const current = await seed(db, alice.id),
          other = await seed(db, bob.id);
        const run = (query: string, variables = {}, who = manager, role = "facilitator") =>
          gql(target, url, who, role, query, variables);
        const changed = async (query: string, variables: Record<string, unknown>, field: string) =>
          expect(data(await run(query, variables), field)).toMatchObject({ affected_rows: 1 });
        const read = async () =>
          (
            data(
              await run(followUpsQuery, current),
              "retroQuestions",
            ) as FollowUpsResult["retroQuestions"]
          )[0];
        const input = {
          questionId: current.questionId,
          action: "  Improve release notes\u3000",
          ownerId: alice.id,
          ticketUrl: " https://github.com/acme/repo/issues/42 ",
        };
        await changed(addFollowUp, input, "insertRetroFollowUps");
        const first = (await read()).followUps[0];
        const editInput = {
          id: first.id,
          action: input.action,
          ownerId: input.ownerId,
          ticketUrl: input.ticketUrl,
        };
        expect(first).toMatchObject({
          action: "Improve release notes",
          ownerId: alice.id,
          ticketUrl: "https://github.com/acme/repo/issues/42",
          owner: { id: alice.id, email: alice.email },
        });
        await changed(
          addFollowUp,
          { ...input, action: "A second action", ticketUrl: "\uFEFF\u3000 " },
          "insertRetroFollowUps",
        );
        expect((await read()).followUps[1].ticketUrl).toBeNull();
        expect(
          data(
            await run(followUpsQuery, { ...current, sessionId: other.sessionId }),
            "retroQuestions",
          ),
        ).toEqual([]);
        expect(
          data(await run(followUpSummaryQuery, { sessionId: current.sessionId }), "retroSessions"),
        ).toMatchObject([
          {
            questions: [
              {
                id: current.questionId,
                followUps: [{ id: first.id }, { action: "A second action" }],
              },
            ],
          },
        ]);
        for (const action of [" \uFEFF\u3000 ", "x".repeat(501), "😀".repeat(501)]) {
          denied(await run(addFollowUp, { ...input, action }));
          denied(await run(editFollowUp, { ...editInput, action }));
        }
        for (const ticketUrl of [
          "javascript:alert(1)",
          "data:text/html,bad",
          "ftp://example.com/42",
          "//example.com/42",
          "https://",
          "https://example.com/has space",
          "https://example.com/a\u00A0b",
          "https://example.com/a\uFEFFb",
          "https://example.com/a\u202Fb",
          "https://example.com/a\u2007b",
          "https://example.com/a\u3000b",
          "https://example.com/a\u2028b",
          "https://example.com/a\u0085b",
          "https://example.com/a\u0080b",
          "https://\u017F.com/1",
          "https://\u212A.com/1",
          "https://example.com/\\evil",
          "https://user:pass@example.com/42",
          `https://example.com/${"x".repeat(2048)}`,
        ]) {
          denied(await run(addFollowUp, { ...input, ticketUrl }));
          denied(await run(editFollowUp, { ...editInput, ticketUrl }));
        }
        for (const ticketUrl of [
          "HTTP://Tickets.Example.COM:8080/42",
          "hTtPs://Tickets.Example.COM/42",
          "https://example.com/café/😀?issue=K#details",
        ]) {
          await changed(addFollowUp, { ...input, ticketUrl }, "insertRetroFollowUps");
          await changed(editFollowUp, { ...editInput, ticketUrl }, "updateRetroFollowUps");
        }
        await changed(
          editFollowUp,
          { ...editInput, action: "😀".repeat(500), ticketUrl: null },
          "updateRetroFollowUps",
        );
        for (const ownerId of [bob.id, manager.id, randomUUID()]) {
          denied(await run(addFollowUp, { ...input, ownerId }));
          denied(await run(editFollowUp, { ...editInput, ownerId }));
        }
        denied(await run(addFollowUp, { ...input, questionId: randomUUID() }));
        await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
          current.sessionId,
          bob.id,
        ]);
        await db.query("UPDATE auth.users SET disabled=true WHERE id=$1", [bob.id]);
        denied(await run(editFollowUp, { ...editInput, ownerId: bob.id }));
        await db.query("UPDATE auth.users SET disabled=false WHERE id=$1", [bob.id]);
        await changed(editFollowUp, { ...editInput, ownerId: bob.id }, "updateRetroFollowUps");
        await db.query(
          "DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2",
          [current.sessionId, bob.id],
        );
        // Removing membership neither erases the action nor anonymizes its owner.
        expect((await read()).followUps[0].owner?.id).toBe(bob.id);
        await changed(
          editFollowUp,
          { ...editInput, ownerId: bob.id, action: "Retained owner", ticketUrl: null },
          "updateRetroFollowUps",
        );
        denied(await run(addFollowUp, { ...input, ownerId: bob.id }));
        const deleteQuestion =
          "mutation($id: uuid!) { deleteRetroQuestions(where: {id: {_eq: $id}}) { affected_rows } }";
        denied(await run(deleteQuestion, { id: current.questionId }), "deleteRetroQuestions");
        await expect(
          db.query("DELETE FROM retro_questions WHERE id=$1", [current.questionId]),
        ).rejects.toThrow();
        // Read types exist, but active-session outcomes stay private for the user role.
        expect(
          data(await run(participantFollowUpsQuery, current, alice, "user"), "retroQuestions"),
        ).toEqual([]);
        expect(
          data(
            await run(followUpSummaryQuery, { sessionId: current.sessionId }, alice, "user"),
            "retroSessions",
          ),
        ).toMatchObject([{ questions: [{ followUps: [] }] }]);
        for (const [query, field] of [
          ["query { retroFollowUps { id action owner { email } } }", "retroFollowUps"],
          ["query { retroFollowUpOwners { id email } }", "retroFollowUpOwners"],
          ["query { retroQuestions(where: {followUps: {}}) { id } }", "retroQuestions"],
        ]) {
          expect(data(await run(query, {}, alice, "user"), field)).toEqual([]);
          expect(data(await run(query, {}, manager, "user"), field)).toEqual([]);
        }
        // Management projection (account picker), aggregates and writes remain unavailable.
        const probes: [string, Record<string, unknown>][] = [
          [followUpsQuery, current],
          ["query { retroFollowUpsAggregate { aggregate { count } } }", {}],
          [addFollowUp, input],
          [editFollowUp, { ...editInput }],
          [deleteFollowUp, { id: first.id }],
        ];
        for (const [query, variables] of probes) {
          denied(await run(query, variables, alice, "user"));
          denied(await run(query, variables, manager, "user"));
        }
        denied(await run(followUpsQuery, current, alice, "facilitator"));
        denied(await run("query { retroFollowUpOwners { passwordHash metadata roles { role } } }"));
        for (const column of ["id", "questionId", "createdAt"]) {
          const value = column === "createdAt" ? "2020-01-01T00:00:00Z" : randomUUID();
          denied(
            await run(
              `mutation { updateRetroFollowUps(where: {}, _set: {${column}: "${value}"}) { affected_rows } }`,
            ),
          );
        }
        for (const sql of [
          "UPDATE retro_follow_ups SET id=gen_random_uuid() WHERE id=$1",
          "UPDATE retro_follow_ups SET question_id=gen_random_uuid() WHERE id=$1",
          "UPDATE retro_follow_ups SET created_at=now()+interval '1 day' WHERE id=$1",
        ])
          await expect(db.query(sql, [first.id])).rejects.toThrow();
        // No closure lock or predicate on outcomes: all three operations remain available.
        await db.query("UPDATE retro_sessions SET ended=true WHERE id=$1", [current.sessionId]);
        await changed(
          addFollowUp,
          { ...input, action: "After ending", ticketUrl: null },
          "insertRetroFollowUps",
        );
        await changed(
          editFollowUp,
          { ...editInput, action: "After ending", ownerId: alice.id },
          "updateRetroFollowUps",
        );
        // Every operation rechecks live facilitator eligibility, not just the JWT.
        await db.query("DELETE FROM auth.user_roles WHERE user_id=$1 AND role='facilitator'", [
          manager.id,
        ]);
        expect(data(await run(followUpsQuery, current), "retroQuestions")).toEqual([]);
        expect(
          data(await run("query { retroFollowUpOwners { id } }"), "retroFollowUpOwners"),
        ).toEqual([]);
        denied(await run(addFollowUp, input));
        denied(await run(editFollowUp, { ...editInput }), "updateRetroFollowUps");
        denied(await run(deleteFollowUp, { id: first.id }), "deleteRetroFollowUps");
        await setFacilitator(db, manager.id, "grant");
        denied(await run(editFollowUp, { ...editInput, id: randomUUID() }), "updateRetroFollowUps");
        denied(await run(deleteFollowUp, { id: randomUUID() }), "deleteRetroFollowUps");
        for (const followUp of (await read()).followUps)
          await changed(deleteFollowUp, { id: followUp.id }, "deleteRetroFollowUps");
        expect((await read()).followUps).toEqual([]);
      }
    } finally {
      await db.end();
      for (const who of [alice, bob, manager]) await cleanupActor(target, who.id);
    }
  });

  it("rejects stale assignments when participant removal wins the membership lock", async () => {
    const target = await guard(),
      group = await newGroup(target);
    const owner = await actor(group),
      manager = await actor(group);
    const db = await connect(target),
      lock = await connect(target);
    try {
      await setFacilitator(db, manager.id, "grant");
      await manager.refresh();
      await lock.query("SET statement_timeout='8s'; SET lock_timeout='7s'");
      const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        const current = await seed(db, owner.id);
        await lock.query("BEGIN");
        await lock.query(
          "DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2",
          [current.sessionId, owner.id],
        );
        const writing = gql(target, url, manager, "facilitator", addFollowUp, {
          questionId: current.questionId,
          action: "Stale assignment",
          ownerId: owner.id,
          ticketUrl: null,
        });
        await blocked(db, pid);
        await lock.query("COMMIT");
        denied(await writing);
        expect(
          (
            await db.query("SELECT id FROM retro_follow_ups WHERE question_id=$1", [
              current.questionId,
            ])
          ).rows,
        ).toEqual([]);
      }
    } finally {
      await lock.query("ROLLBACK");
      await Promise.all([db.end(), lock.end()]);
      for (const who of [owner, manager]) await cleanupActor(target, who.id);
    }
  });
});
