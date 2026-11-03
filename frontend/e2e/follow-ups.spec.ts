import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext } from "@playwright/test";
import { setFacilitator } from "../../backend/scripts/facilitator";
import { type Actor, actor, cleanupActor, newGroup } from "../../backend/tests/lib/auth";
import { connect, guard } from "../../backend/tests/lib/target";
import { browserGraphql, expect, newContext, test } from "./fixtures";

async function seed(context: BrowserContext, fixture: Actor) {
  const claims = JSON.parse(
    Buffer.from(fixture.session.accessToken.split(".")[1], "base64url").toString(),
  );
  await context.addInitScript(
    (value) => {
      if (!localStorage.getItem("fixture-seeded")) {
        localStorage.setItem("nhostSession", JSON.stringify(value));
        localStorage.setItem("fixture-seeded", "yes");
      }
    },
    {
      ...fixture.session,
      decodedToken: { ...claims, exp: claims.exp * 1000, iat: claims.iat * 1000 },
    },
  );
}

test("facilitators manage actions; participants gain a read-only board and follow-ups only after ending", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const target = await guard(),
    group = await newGroup(target);
  const manager = await actor(group),
    alice = await actor(group),
    bob = await actor(group);
  const db = await connect(target);
  const participantContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  try {
    await setFacilitator(db, manager.id, "grant");
    await manager.refresh();
    await db.query("UPDATE auth.users SET display_name='Alice' WHERE id=$1", [alice.id]);
    await db.query("UPDATE auth.users SET display_name='Bob' WHERE id=$1", [bob.id]);
    const sessionId = (
      await db.query("INSERT INTO retro_sessions(name) VALUES('Follow-up journey') RETURNING id")
    ).rows[0].id;
    const questionId = (
      await db.query(
        "INSERT INTO retro_questions(session_id,text) VALUES($1,'What should we improve next?') RETURNING id",
        [sessionId],
      )
    ).rows[0].id;
    for (const userId of [alice.id, bob.id])
      await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
        sessionId,
        userId,
      ]);
    for (const [ctx, fixture] of [
      [context, manager],
      [participantContext, alice],
    ] as const) {
      await ctx.route(`${target.endpoints.auth}/**`, (route) => {
        if (route.request().method() === "POST")
          group.budget.spend(new URL(route.request().url()).pathname.replace(/^\/v1/, ""));
        return route.continue();
      });
      await seed(ctx, fixture);
    }
    for (const [author, text] of [
      [alice.id, "Alice: protect focus time"],
      [bob.id, "Bob: share release context"],
    ])
      await db.query("INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,$3)", [
        questionId,
        author,
        text,
      ]);
    const topicId = (
      await db.query(
        "INSERT INTO retro_topics(question_id,name) VALUES($1,'Communication') RETURNING id",
        [questionId],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO retro_answer_topics(answer_id,question_id,topic_id) SELECT id,question_id,$2 FROM retro_answers WHERE question_id=$1 AND author_id=$3",
      [questionId, topicId, bob.id],
    );
    const participant = await participantContext.newPage();
    const participantRequests: string[] = [];
    participant.on("request", (request) => {
      if (request.url() === browserGraphql(target))
        participantRequests.push(request.postDataJSON()?.query ?? "");
    });
    const path = `/facilitate/${sessionId}/questions/${questionId}`;
    await page.goto(path);
    const composer = page.getByRole("form", { name: "New follow-up" });
    await composer.getByLabel("Action", { exact: true }).fill("Improve release notes");
    await composer.getByLabel("Owner", { exact: true }).selectOption(alice.id);
    await composer.getByRole("button", { name: "Add follow-up", exact: true }).click();
    await expect(page.getByText("Improve release notes", { exact: true })).toBeVisible();
    await expect(page.getByText("No ticket linked yet.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit follow-up 1", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit follow-up 1", exact: true });
    await expect(editor.getByLabel("Action", { exact: true })).toBeFocused();
    await editor.getByLabel("Owner", { exact: true }).selectOption(bob.id);
    await editor
      .getByLabel("Ticket link (optional)", { exact: true })
      .fill("https://linear.app/acme/issue/ACME-42");
    await editor.getByRole("button", { name: "Save follow-up", exact: true }).click();
    await expect(page.getByRole("link", { name: /Open ticket/ })).toHaveAttribute(
      "href",
      "https://linear.app/acme/issue/ACME-42",
    );
    await expect(page.getByText(`Owner: Bob (${bob.email})`, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "← Back to session", exact: true }).click();
    const summary = page.getByRole("region", { name: "Follow-up summary", exact: true });
    await expect(summary.getByText("Improve release notes", { exact: true })).toBeVisible();
    await participant.goto(`/sessions/${sessionId}`);
    await expect(participant.getByText("Alice: protect focus time", { exact: true })).toBeVisible();
    await expect(participant.getByText("Bob: share release context", { exact: true })).toHaveCount(
      0,
    );
    await expect(participant.getByRole("region", { name: "Follow-up summary" })).toHaveCount(0);
    expect(participantRequests.some((query) => /FollowUps/.test(query))).toBe(false);
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await summary.getByRole("link", { name: "What should we improve next?", exact: true }).click();
    await composer
      .getByLabel("Action", { exact: true })
      .fill("Track the rollout after the retrospective");
    await composer.getByLabel("Owner", { exact: true }).selectOption(alice.id);
    await composer.getByRole("button", { name: "Add follow-up", exact: true }).click();
    await expect(
      page.getByText("Track the rollout after the retrospective", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete follow-up 2", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete follow-up 2", exact: true })
      .click();
    await expect(
      page.getByText("Track the rollout after the retrospective", { exact: true }),
    ).toHaveCount(0);
    await db.query("DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2", [
      sessionId,
      bob.id,
    ]);
    await page.getByRole("button", { name: "Edit follow-up 1", exact: true }).click();
    const retainedOwner = editor.getByRole("option", {
      name: `Bob (${bob.email}) — unavailable; keep current owner`,
      exact: true,
    });
    await expect(retainedOwner).toBeEnabled();
    await expect(editor.getByLabel("Owner", { exact: true })).toHaveValue(bob.id);
    await editor.getByLabel("Owner", { exact: true }).selectOption(alice.id);
    await editor.getByLabel("Owner", { exact: true }).selectOption(bob.id);
    await editor.getByLabel("Action", { exact: true }).fill("Publish release notes after ending");
    await editor.getByRole("button", { name: "Save follow-up", exact: true }).click();
    await expect(
      page.getByText("Publish release notes after ending", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(`Owner: Bob (${bob.email})`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((issue) =>
        ["serious", "critical"].includes(issue.impact ?? ""),
      ),
    ).toEqual([]);
    const participantSummary = participant.getByRole("region", { name: "Follow-up summary" });
    await expect(
      participantSummary.getByText("Publish release notes after ending", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await participantSummary
      .getByRole("link", { name: "What should we improve next?", exact: true })
      .click();
    await expect(participant.getByRole("region", { name: "Reflection board" })).toBeVisible();
    await expect(
      participant
        .getByRole("region", { name: "Communication", exact: true })
        .getByText("Bob: share release context", { exact: true }),
    ).toBeVisible();
    await expect(participant.getByText("Alice: protect focus time", { exact: true })).toBeVisible();
    await expect(participant.getByText(`Owner: Bob (${bob.email})`, { exact: true })).toBeVisible();
    await expect(participant.getByRole("link", { name: /Open ticket/ })).toHaveAttribute(
      "href",
      "https://linear.app/acme/issue/ACME-42",
    );
    await expect(
      participant.getByRole("button", {
        name: /Drag card|Rename theme|Delete theme|New theme|Edit follow-up|Delete follow-up|Add follow-up/,
      }),
    ).toHaveCount(0);
    await expect(participant.getByLabel(/^Move card/)).toHaveCount(0);
    await expect(participant.getByRole("form")).toHaveCount(0);
    expect(
      participantRequests.some((query) => /mutation|query QuestionFollowUps\(/.test(query)),
    ).toBe(false);
    const participantAccessibility = await new AxeBuilder({ page: participant }).analyze();
    expect(
      participantAccessibility.violations.filter((issue) =>
        ["serious", "critical"].includes(issue.impact ?? ""),
      ),
    ).toEqual([]);
    await db.query("DELETE FROM retro_session_participants WHERE session_id=$1 AND user_id=$2", [
      sessionId,
      alice.id,
    ]);
    await expect(participant.getByRole("heading", { name: "Question unavailable" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(participant.getByText("Bob: share release context", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      participant.getByText("Publish release notes after ending", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await participantContext.close();
    await db.end();
    for (const fixture of [alice, bob, manager]) await cleanupActor(target, fixture.id);
  }
});
