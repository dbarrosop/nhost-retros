import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { setFacilitator } from "../../backend/scripts/facilitator";
import { type Actor, actor, cleanupActor, newGroup } from "../../backend/tests/lib/auth";
import { connect, guard } from "../../backend/tests/lib/target";
import { browserGraphql, expect, newContext, test } from "./fixtures";

function stored(fixture: Actor) {
  const claims = JSON.parse(
    Buffer.from(fixture.session.accessToken.split(".")[1], "base64url").toString(),
  );
  return {
    ...fixture.session,
    decodedToken: { ...claims, exp: claims.exp * 1000, iat: claims.iat * 1000 },
  };
}
async function seed(context: BrowserContext, fixture: Actor) {
  await context.addInitScript((value) => {
    if (!localStorage.getItem("fixture-seeded")) {
      localStorage.setItem("nhostSession", JSON.stringify(value));
      localStorage.setItem("fixture-seeded", "yes");
    }
  }, stored(fixture));
}

test("independent browsers synchronize cards, grouping and closure; old requests cannot cross signout or revocation", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const target = await guard(),
    group = await newGroup(target);
  const graphqlUrl = browserGraphql(target);
  const alice = await actor(group),
    first = await actor(group),
    second = await actor(group),
    bob = await actor(group);
  const db = await connect(target);
  const firstContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  const secondContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  let release = () => {};
  try {
    for (const manager of [first, second]) {
      await setFacilitator(db, manager.id, "grant");
      await manager.refresh();
    }
    const sessionId = (
      await db.query("INSERT INTO retro_sessions(name) VALUES($1) RETURNING id", [
        `Live conversation ${randomUUID()}`,
      ])
    ).rows[0].id;
    const questionId = (
      await db.query(
        "INSERT INTO retro_questions(session_id,text) VALUES($1,'What needs room to grow?') RETURNING id",
        [sessionId],
      )
    ).rows[0].id;
    for (const userId of [alice.id, bob.id])
      await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
        sessionId,
        userId,
      ]);
    for (const [ctx, fixture] of [
      [context, alice],
      [firstContext, first],
      [secondContext, second],
    ] as const) {
      await ctx.route(`${target.endpoints.auth}/**`, (route) => {
        if (route.request().method() === "POST")
          group.budget.spend(new URL(route.request().url()).pathname.replace(/^\/v1/, ""));
        return route.continue();
      });
      await seed(ctx, fixture);
    }
    const leader = await firstContext.newPage(),
      observer = await secondContext.newPage();
    let boardSnapshot: unknown;
    observer.on("response", async (response) => {
      if (
        response.url() === graphqlUrl &&
        response.request().postDataJSON()?.query.startsWith("query QuestionBoard")
      )
        boardSnapshot = await response.json();
    });
    const boardPath = `/facilitate/${sessionId}/questions/${questionId}`;
    await Promise.all([
      page.goto(`/sessions/${sessionId}`),
      leader.goto(boardPath),
      observer.goto(boardPath),
    ]);
    for (const view of [leader, observer])
      await expect(view.getByRole("region", { name: "Reflection board" })).toBeVisible();
    await observer.getByLabel("New topic", { exact: true }).fill("An unsaved observer theme");
    await page
      .getByLabel("New card for question 1", { exact: true })
      .fill("Make room for deeper work");
    await page.getByRole("button", { name: "Add card to question 1", exact: true }).click();
    await expect(page.getByText("Make room for deeper work", { exact: true })).toBeVisible();
    // Each five-second bound starts after the source browser confirms its write.
    await Promise.all(
      [leader, observer].map(async (view) => {
        await expect(view.getByText("Make room for deeper work", { exact: true })).toBeVisible({
          timeout: 5_000,
        });
        await expect(view.getByText(alice.email, { exact: true })).toBeVisible();
      }),
    );
    await leader.getByLabel("New topic", { exact: true }).fill("Focus time");
    await leader.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect(leader.getByRole("region", { name: "Focus time", exact: true })).toBeVisible();
    await expect(observer.getByRole("region", { name: "Focus time", exact: true })).toBeVisible({
      timeout: 5_000,
    });
    const topicId = (
      await db.query("SELECT id FROM retro_topics WHERE question_id=$1", [questionId])
    ).rows[0].id;
    await leader
      .getByRole("combobox", { name: "Move card 1 to", exact: true })
      .selectOption(topicId);
    await expect(
      leader.getByRole("region", { name: "Focus time", exact: true }).getByRole("article"),
    ).toHaveCount(1);
    await expect(
      observer.getByRole("region", { name: "Focus time", exact: true }).getByRole("article"),
    ).toHaveCount(1, { timeout: 5_000 });
    await expect(observer.getByLabel("New topic", { exact: true })).toHaveValue(
      "An unsaved observer theme",
    );

    // Offline routes issue no polls, retain drafts and catch up without a reload.
    await observer.clock.install();
    let reads = 0;
    observer.on("request", (request) => {
      if (request.url() === graphqlUrl) reads++;
    });
    await secondContext.setOffline(true);
    await expect(observer.getByRole("status", { name: "Workspace connection" })).toContainText(
      "You’re offline",
    );
    const offlineReads = reads;
    await observer.clock.runFor(6000);
    expect(reads).toBe(offlineReads);
    await leader.getByLabel("New topic", { exact: true }).fill("Reconnected theme");
    await leader.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect(
      leader.getByRole("region", { name: "Reconnected theme", exact: true }),
    ).toBeVisible();
    await secondContext.setOffline(false);
    await expect(
      observer.getByRole("region", { name: "Reconnected theme", exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await leader.getByRole("button", { name: "Delete topic Focus time", exact: true }).click();
    await leader
      .getByRole("dialog")
      .getByRole("button", { name: "Delete topic Focus time", exact: true })
      .click();
    await expect(leader.getByRole("region", { name: "Focus time", exact: true })).toHaveCount(0);
    await expect(observer.getByRole("region", { name: "Focus time", exact: true })).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(
      observer.getByRole("region", { name: "Ungrouped", exact: true }).getByRole("article"),
    ).toHaveCount(1);
    await expect(observer.getByLabel("New topic", { exact: true })).toHaveValue(
      "An unsaved observer theme",
    );

    await page.getByRole("button", { name: "Edit card 1 for question 1", exact: true }).click();
    await page
      .getByLabel("Edit card 1 for question 1", { exact: true })
      .fill("An unsaved edit survives closure");
    await page
      .getByLabel("New card for question 1", { exact: true })
      .fill("An unsaved new card survives closure");
    await leader.goto(`/facilitate/${sessionId}`);
    await leader.getByRole("button", { name: "End session", exact: true }).click();
    await leader
      .getByRole("dialog")
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(leader.getByText(/permanently read-only/)).toBeVisible();
    await Promise.all([
      expect(page.getByLabel("Edit card 1 for question 1", { exact: true })).toBeDisabled({
        timeout: 5_000,
      }),
      expect(observer.getByText(/Answer content is permanently frozen/)).toBeVisible({
        timeout: 5_000,
      }),
    ]);
    await expect(page.getByLabel("Edit card 1 for question 1", { exact: true })).toHaveValue(
      "An unsaved edit survives closure",
    );
    await expect(page.getByLabel("New card for question 1", { exact: true })).toHaveValue(
      "An unsaved new card survives closure",
    );

    // Replay a browser-captured authentic response across signout. route.fetch
    // runs in Node (outside Chromium's local DNS mapping) and can log JWT headers
    // on failure, so authenticated test traffic stays inside the browser.
    expect(Boolean(boardSnapshot)).toBe(true);
    let captured = () => {};
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delivered = () => {};
    const completed = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let hold = true;
    await observer.route(graphqlUrl, async (route) => {
      if (hold && route.request().postDataJSON()?.query.startsWith("query QuestionBoard")) {
        hold = false;
        captured();
        await gate;
        await route.fulfill({ json: boardSnapshot });
        delivered();
      } else await route.continue();
    });
    await observer.clock.runFor(2000);
    await ready;
    await observer.getByText("Account", { exact: true }).click();
    await observer.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      observer.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    release();
    await completed;
    await bob.refresh();
    await observer.evaluate((value) => {
      localStorage.setItem("nhostSession", JSON.stringify(value));
      window.dispatchEvent(new StorageEvent("storage", { key: "nhostSession" }));
    }, stored(bob));
    await observer.goto(`/sessions/${sessionId}`);
    await expect(
      observer.getByRole("heading", { name: "Your reflection cards", exact: true }),
    ).toBeVisible();
    await expect(observer.getByRole("article")).toHaveCount(0);
    await expect(observer.getByText(alice.email, { exact: true })).toHaveCount(0);
    await expect(observer.getByText("Make room for deeper work", { exact: true })).toHaveCount(0);
    await observer.goto(boardPath);
    await expect(observer).toHaveURL(/\/workspace$/);
    await expect(observer.getByLabel("New topic", { exact: true })).toHaveCount(0);

    await leader.goto(boardPath);
    await expect(leader.getByText(alice.email, { exact: true })).toBeVisible();
    // The old JWT still claims facilitator: live database membership wins.
    await setFacilitator(db, first.id, "revoke");
    await expect(
      leader.getByRole("heading", { name: "Question unavailable", exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(leader.getByText(alice.email, { exact: true })).toHaveCount(0);
    await db.query("UPDATE auth.users SET disabled=true WHERE id=$1", [alice.id]);
    await expect(
      page.getByRole("heading", { name: "Session unavailable", exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(group.budget.email).toBe(0);
    expect(group.budget.signin).toBe(4);
  } finally {
    release();
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
    await db.end();
    for (const fixture of [alice, first, second, bob]) await cleanupActor(target, fixture.id);
  }
});
