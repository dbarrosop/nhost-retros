import { randomUUID } from "node:crypto";
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

test("two people keep multiple private cards; closure rejects a stale draft without losing it", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const target = await guard(),
    group = await newGroup(target);
  const graphqlUrl = browserGraphql(target);
  const alice = await actor(group),
    bob = await actor(group),
    manager = await actor(group);
  const db = await connect(target);
  const bobContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  const managerContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  try {
    await setFacilitator(db, manager.id, "grant");
    await manager.refresh();
    const name = `Private reflections ${randomUUID()}`;
    const sessionId = (
      await db.query("INSERT INTO retro_sessions(name) VALUES($1) RETURNING id", [name])
    ).rows[0].id;
    await db.query(
      "INSERT INTO retro_questions(session_id,text) VALUES($1,'What deserves more space?')",
      [sessionId],
    );
    await db.query(
      "INSERT INTO retro_questions(session_id,text) VALUES($1,'What would make next time better?')",
      [sessionId],
    );
    for (const userId of [alice.id, bob.id])
      await db.query("INSERT INTO retro_session_participants(session_id,user_id) VALUES($1,$2)", [
        sessionId,
        userId,
      ]);
    for (const [ctx, fixture] of [
      [context, alice],
      [bobContext, bob],
      [managerContext, manager],
    ] as const) {
      await ctx.route(`${target.endpoints.auth}/**`, (route) => {
        if (route.request().method() === "POST")
          group.budget.spend(new URL(route.request().url()).pathname.replace(/^\/v1/, ""));
        return route.continue();
      });
      await seed(ctx, fixture);
    }
    const other = await bobContext.newPage(),
      facilitator = await managerContext.newPage();
    const startupFailures: string[] = [];
    facilitator.on("pageerror", (error) => startupFailures.push(error.name));
    facilitator.on("requestfailed", (request) => {
      // Paths and browser failure codes only; no headers, tokens or response bodies.
      startupFailures.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
    });
    await page.goto(`/sessions/${sessionId}`);
    await other.goto(`/sessions/${sessionId}`);
    // Question changes retain drafts without submitting them or exposing another question's cards.
    const firstDraft = page.getByLabel("New card for question 1", { exact: true });
    await firstDraft.fill("A first-question draft");
    const chooser = page.locator(".question-chooser > summary");
    await chooser.click();
    const secondQuestion = page.locator(".question-chooser-options").getByRole("button", {
      name: /2\.\s*What would make next time better/,
    });
    await secondQuestion.hover();
    await page.mouse.down();
    try {
      // Pointer focus changes must not hide the option before its click fires.
      await page.getByRole("main").evaluate((element) => {
        if (element instanceof HTMLElement) element.focus({ preventScroll: true });
      });
      await expect(secondQuestion).toBeVisible();
    } finally {
      await page.mouse.up();
    }
    await expect(chooser).toHaveText("Question 2 of 2");
    await expect(page.locator(".question-chooser")).not.toHaveAttribute("open", "");
    await expect(
      page.getByRole("heading", { name: "What deserves more space?" }),
    ).not.toBeVisible();
    await page
      .getByLabel("New card for question 2", { exact: true })
      .fill("A second-question draft");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(firstDraft).toHaveValue("A first-question draft");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByLabel("New card for question 2", { exact: true })).toHaveValue(
      "A second-question draft",
    );
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    const observations = [
      "Alice: time for deep work",
      "Alice: fewer interruptions",
      "Bob: clearer decisions",
      "Bob: celebrate small wins",
    ];
    for (const [view, texts] of [
      [page, observations.slice(0, 2)],
      [other, observations.slice(2)],
    ] as const) {
      for (const text of texts) {
        const composer = view.getByLabel("New card for question 1", { exact: true });
        const add = view.getByRole("button", { name: "Add card to question 1", exact: true });
        await composer.fill(text);
        await composer.press("Tab");
        await expect(add).toBeFocused();
        await add.press("Enter");
        await expect(view.getByText(text, { exact: true })).toBeVisible();
        await expect(add).toBeFocused();
      }
      await expect(view.getByRole("article")).toHaveCount(2);
      await expect(view.getByText(/Only you and trusted facilitators/)).toBeVisible();
    }
    for (const text of observations.slice(2))
      await expect(page.getByText(text, { exact: true })).not.toBeVisible();
    for (const text of observations.slice(0, 2))
      await expect(other.getByText(text, { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Edit card 1 for question 1", exact: true }).click();
    await page
      .getByLabel("Edit card 1 for question 1", { exact: true })
      .fill("Alice: protect our focus time");
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    await expect(page.getByText("Alice: protect our focus time", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete card 2 for question 1", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete card 2 for question 1", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Delete card 2 for question 1", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete card 2 for question 1", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(
      page
        .getByRole("region", { name: "Your reflection cards for question 1", exact: true })
        .getByRole("heading", { name: "Your reflection cards", exact: true }),
    ).toBeFocused();
    await expect(other.getByRole("article")).toHaveCount(2);
    await page
      .getByLabel("New card for question 1", { exact: true })
      .fill("Alice: a second retained card");
    await page.getByRole("button", { name: "Add card to question 1", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(2);

    // Replay a genuinely captured active session read to simulate an arbitrarily
    // stale tab, while all answer reads and mutations still hit the real engine.
    let stale = false;
    let activeSnapshot: unknown;
    page.on("response", async (response) => {
      if (
        response.url() === graphqlUrl &&
        !stale &&
        response.request().postDataJSON()?.query.startsWith("query Session(")
      ) {
        activeSnapshot = await response.json();
      }
    });
    await page.route(graphqlUrl, (route) => {
      const query = route.request().postDataJSON().query as string;
      return stale && query.startsWith("query Session(")
        ? route.fulfill({ json: activeSnapshot })
        : route.continue();
    });
    await expect.poll(() => Boolean(activeSnapshot), { timeout: 5_000 }).toBe(true);
    stale = true;
    await page.getByRole("button", { name: "Edit card 1 for question 1", exact: true }).click();
    await page
      .getByLabel("Edit card 1 for question 1", { exact: true })
      .fill("Keep this unsaved edit");
    await page
      .getByLabel("New card for question 1", { exact: true })
      .fill("Keep this unsaved new thought");
    await facilitator.goto(`/facilitate/${sessionId}`);
    try {
      await expect(facilitator.getByRole("main")).toBeVisible();
    } catch (error) {
      throw new Error(`Facilitator bootstrap failed: ${startupFailures.join(", ")}`, {
        cause: error,
      });
    }
    await facilitator.getByRole("button", { name: "End session", exact: true }).click();
    await facilitator
      .getByRole("dialog")
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(facilitator.getByText(/permanently read-only/)).toBeVisible();
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("This change wasn’t saved");
    await expect(page.getByLabel("Edit card 1 for question 1", { exact: true })).toHaveValue(
      "Keep this unsaved edit",
    );
    await page.getByRole("button", { name: "Add card to question 1", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(2);
    stale = false;
    await expect(page.getByLabel("Edit card 1 for question 1", { exact: true })).toBeDisabled({
      timeout: 5_000,
    });
    await expect(page.getByLabel("New card for question 1", { exact: true })).toHaveValue(
      "Keep this unsaved new thought",
    );
    await expect(page.getByLabel("New card for question 1", { exact: true })).toBeDisabled();
    await expect(other.getByRole("button", { name: /Edit card|Delete card/ })).toHaveCount(0);
    await expect(other.getByRole("article")).toHaveCount(2);
    for (const view of [page, other, facilitator])
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    expect(group.budget.email).toBe(0);
    expect(group.budget.signin).toBe(3);
    const rows = (
      await db.query(
        "SELECT a.text FROM retro_answers a JOIN retro_questions q ON q.id=a.question_id WHERE q.session_id=$1 ORDER BY a.text",
        [sessionId],
      )
    ).rows;
    expect(rows.map((r) => r.text).sort()).toEqual(
      [
        "Alice: protect our focus time",
        "Alice: a second retained card",
        ...observations.slice(2),
      ].sort(),
    );
  } finally {
    await Promise.allSettled([bobContext.close(), managerContext.close()]);
    await db.end();
    for (const fixture of [alice, bob, manager]) await cleanupActor(target, fixture.id);
  }
});
