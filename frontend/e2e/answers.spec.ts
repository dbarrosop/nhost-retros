import { randomUUID } from "node:crypto";
import { type BrowserContext, expect, test } from "@playwright/test";
import { setFacilitator } from "../../backend/scripts/facilitator";
import { type Actor, actor, cleanupActor, newGroup } from "../../backend/tests/lib/auth";
import { connect, guard } from "../../backend/tests/lib/target";

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
  const alice = await actor(group),
    bob = await actor(group),
    manager = await actor(group);
  const db = await connect(target);
  const bobContext = await browser.newContext({
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  const managerContext = await browser.newContext({
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
    await page.goto(`/sessions/${sessionId}`);
    await other.goto(`/sessions/${sessionId}`);
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
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "What deserves more space?" }) })
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
        response.url() === target.endpoints.graphql &&
        !stale &&
        response.request().postDataJSON()?.query.startsWith("query Session(")
      ) {
        activeSnapshot = await response.json();
      }
    });
    await page.route(target.endpoints.graphql, (route) => {
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
    await bobContext.close();
    await managerContext.close();
    await db.end();
    for (const fixture of [alice, bob, manager]) await cleanupActor(target, fixture.id);
  }
});
