import { randomUUID } from "node:crypto";
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

test("trusted facilitators cluster accessibly, including after closure, without changing content", async ({
  page,
  context,
  browser,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const target = await guard(),
    group = await newGroup(target);
  const graphqlUrl = browserGraphql(target);
  const manager = await actor(group),
    alice = await actor(group);
  const db = await connect(target);
  const participantContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  try {
    await setFacilitator(db, manager.id, "grant");
    await manager.refresh();
    await db.query("UPDATE auth.users SET display_name='Alice' WHERE id=$1", [alice.id]);
    const sessionId = (
      await db.query("INSERT INTO retro_sessions(name) VALUES($1) RETURNING id", [
        `Clustering ${randomUUID()}`,
      ])
    ).rows[0].id;
    const questionId = (
      await db.query(
        "INSERT INTO retro_questions(session_id,text) VALUES($1,'What should we make space for?') RETURNING id",
        [sessionId],
      )
    ).rows[0].id;
    const answerId = (
      await db.query(
        "INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,'More room for focused work') RETURNING id",
        [questionId, alice.id],
      )
    ).rows[0].id;
    const content = async () =>
      (
        await db.query(
          "SELECT id,question_id,author_id,text,created_at,updated_at FROM retro_answers WHERE question_id=$1 ORDER BY created_at,id",
          [questionId],
        )
      ).rows;
    const original = await content();
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
    const path = `/facilitate/${sessionId}/questions/${questionId}`;
    const participant = await participantContext.newPage();
    const participantBoardRequests: string[] = [];
    participant.on("request", (request) => {
      if (
        request.url() === graphqlUrl &&
        request.postDataJSON()?.query.startsWith("query QuestionBoard")
      )
        participantBoardRequests.push("board");
    });
    await participant.goto(path);
    await expect(participant).toHaveURL(/\/workspace$/);
    await expect(
      participant.getByRole("heading", { name: "Retrospectives", exact: true }),
    ).toBeVisible();
    expect(participantBoardRequests).toEqual([]);
    await expect(participant.getByText("Alice", { exact: true })).toHaveCount(0);

    await page.goto(`/facilitate/${sessionId}`);
    await page.getByRole("link", { name: "Open reflection board for question 1" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "What should we make space for?" }),
    ).toBeVisible();
    await expect(page.getByText(alice.email, { exact: true })).toBeVisible();
    for (const name of ["Keep", "Improve"]) {
      await page.getByLabel("New topic", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Add topic", exact: true }).click();
      await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add topic", exact: true })).toBeFocused();
    }
    const select = () => page.getByRole("combobox", { name: "Move card 1 to", exact: true });
    const handle = () => page.getByRole("button", { name: "Drag card 1", exact: true });
    await expect(handle()).toHaveCSS("touch-action", "none");
    const gripSize = await handle().boundingBox();
    expect(gripSize && gripSize.width >= 44 && gripSize.height >= 44).toBe(true);
    await handle().scrollIntoViewIfNeeded();
    await handle().evaluate((node) =>
      window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 180),
    );
    const start = await handle().boundingBox();
    if (!start) throw new Error("Missing drag geometry");
    const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    const touch = isMobile ? await context.newCDPSession(page) : null;
    if (touch) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 12, from.y, { steps: 3 });
    }
    await expect(page.locator(".drag-preview")).toBeVisible();
    // A real poll completes during the gesture, but cannot replace the held board.
    const refreshed = page.waitForResponse(
      (response) =>
        response.url() === graphqlUrl &&
        response.request().postDataJSON()?.query.startsWith("query QuestionBoard"),
    );
    await db.query("INSERT INTO retro_topics(question_id,name) VALUES($1,'Arrived during drag')", [
      questionId,
    ]);
    await refreshed;
    await expect(
      page.getByRole("heading", { name: "Arrived during drag", exact: true }),
    ).toHaveCount(0);
    // Auto-scroll can change viewport coordinates during a gesture; measure at movement time.
    const destination = await page.getByRole("region", { name: "Keep", exact: true }).boundingBox();
    if (!destination) throw new Error("Missing destination geometry");
    const to = { x: destination.x + destination.width / 2, y: destination.y + 35 };
    if (touch) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
    } else await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByRole("region", { name: "Keep", exact: true })).toHaveClass(
      /drop-target/,
    );
    if (touch) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await touch.detach();
    } else await page.mouse.up();
    await expect(
      page.getByRole("region", { name: "Keep", exact: true }).getByRole("article"),
    ).toHaveCount(1);
    await expect(handle()).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "Arrived during drag", exact: true }),
    ).toBeVisible();

    // The actual keyboard sensor steps to the next column, including stacked mobile.
    await handle().press("Space");
    await expect(page.locator(".drag-preview")).toBeVisible();
    await page.keyboard.press(isMobile ? "ArrowDown" : "ArrowRight");
    await expect(page.getByRole("region", { name: "Improve", exact: true })).toHaveClass(
      /drop-target/,
    );
    await page.keyboard.press("Space");
    await expect(select()).toHaveValue(
      (await db.query("SELECT topic_id FROM retro_answer_topics WHERE answer_id=$1", [answerId]))
        .rows[0].topic_id,
    );
    await expect(
      page.getByRole("region", { name: "Improve", exact: true }).getByRole("article"),
    ).toHaveCount(1);
    await expect(handle()).toBeFocused();
    await handle().press("Space");
    await expect(page.locator(".drag-preview")).toBeVisible();
    // KeyboardSensor attaches its document listeners on the next task; complete a paint first.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.keyboard.press("Escape");
    await expect(handle()).toBeFocused();
    await expect(page.getByRole("status", { name: "Board updates" })).toContainText(
      "Move cancelled",
    );

    // Delete a real destination between choosing it and executing the stale move.
    const keep = (
      await db.query("SELECT id FROM retro_topics WHERE question_id=$1 AND name='Keep'", [
        questionId,
      ])
    ).rows[0].id;
    await page.route(graphqlUrl, async (route) => {
      if (route.request().postDataJSON()?.query.startsWith("mutation MoveAnswer")) {
        await db.query("DELETE FROM retro_topics WHERE id=$1", [keep]);
      }
      await route.continue();
    });
    await select().selectOption(keep);
    await expect(page.getByRole("alert")).toContainText("This grouping change wasn’t saved");
    await expect(page.getByRole("region", { name: "Keep", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Improve", exact: true }).getByRole("article"),
    ).toHaveCount(1);
    await expect(select()).toBeFocused();
    await page.unroute(graphqlUrl);
    await select().selectOption("ungrouped");
    await expect(select()).toHaveValue("ungrouped");
    await expect(select()).toBeFocused();

    await page.getByRole("button", { name: "Rename topic Improve", exact: true }).click();
    await page.getByLabel("Rename topic Improve", { exact: true }).fill("Make space");
    await page.getByRole("button", { name: "Save topic name", exact: true }).click();
    await expect(page.getByRole("region", { name: "Make space", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rename topic Make space", exact: true }),
    ).toBeFocused();
    const topic = (
      await db.query("SELECT id FROM retro_topics WHERE question_id=$1 AND name='Make space'", [
        questionId,
      ])
    ).rows[0].id;
    await select().selectOption(topic);
    await expect(select()).toHaveValue(topic);
    await page.getByRole("button", { name: "Delete topic Make space", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const dialogAxe = await new AxeBuilder({ page }).analyze();
    expect(
      dialogAxe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete topic Make space", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Delete topic Make space", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete topic Make space", exact: true }).click();
    await expect(page.getByRole("region", { name: "Make space", exact: true })).toHaveCount(0);
    await expect(select()).toHaveValue("ungrouped");
    await expect(page.getByRole("heading", { name: "Ungrouped", exact: true })).toBeFocused();
    expect(await content()).toEqual(original);

    await page.getByRole("link", { name: "Back to session" }).click();
    await page.getByRole("button", { name: "End session", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(page.getByText(/permanently read-only/)).toBeVisible();
    await page.getByRole("link", { name: "Open reflection board for question 1" }).click();
    await expect(page.getByText(/topics and grouping remain open/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Edit card|Delete card|Edit question|End session/ }),
    ).toHaveCount(0);
    await page.getByLabel("New topic", { exact: true }).fill("After closure");
    await page.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect(page.getByRole("region", { name: "After closure", exact: true })).toBeVisible();
    const after = (
      await db.query("SELECT id FROM retro_topics WHERE question_id=$1 AND name='After closure'", [
        questionId,
      ])
    ).rows[0].id;
    await select().selectOption(after);
    await expect(select()).toHaveValue(after);
    expect(await content()).toEqual(original);
    // Plain-text wrapping at the actual 4,000-code-point boundary, with no page overflow.
    // Frozen rows cannot be inserted now; exercise the same rendering using a separate active question.
    const longSession = (
      await db.query("INSERT INTO retro_sessions(name) VALUES('Long reflections') RETURNING id")
    ).rows[0].id;
    const longQuestion = (
      await db.query(
        "INSERT INTO retro_questions(session_id,text) VALUES($1,'Long text') RETURNING id",
        [longSession],
      )
    ).rows[0].id;
    await db.query("INSERT INTO retro_answers(question_id,author_id,text) VALUES($1,$2,$3)", [
      longQuestion,
      alice.id,
      "😀".repeat(4000),
    ]);
    const longTopic = (
      await db.query(
        "INSERT INTO retro_topics(question_id,name) VALUES($1,'Long-card theme') RETURNING id",
        [longQuestion],
      )
    ).rows[0].id;
    await page.goto(`/facilitate/${longSession}/questions/${longQuestion}`);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article").locator(".answer-text")).toHaveText("😀".repeat(4000));
    await handle().press("Space");
    await expect(page.locator(".drag-preview")).toBeVisible();
    await page.keyboard.press(isMobile ? "ArrowDown" : "ArrowRight");
    await expect(page.getByRole("region", { name: "Long-card theme", exact: true })).toHaveClass(
      /drop-target/,
    );
    await page.keyboard.press("Space");
    await expect(select()).toHaveValue(longTopic);
    await expect(handle()).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual(
      [],
    );
    expect(group.budget.email).toBe(0);
    expect(group.budget.signin).toBe(2);
  } finally {
    // Timeout teardown may already have closed it; keep the original failed step.
    await Promise.allSettled([participantContext.close()]);
    await db.end();
    for (const fixture of [manager, alice]) await cleanupActor(target, fixture.id);
  }
});
