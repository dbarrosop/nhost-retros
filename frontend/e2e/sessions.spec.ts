import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { setFacilitator } from "../../backend/scripts/facilitator";
import { type Actor, actor, cleanupActor, newGroup } from "../../backend/tests/lib/auth";
import { connect, guard } from "../../backend/tests/lib/target";
import { browserGraphql, expect, newContext, test } from "./fixtures";

async function seed(context: BrowserContext, fixture: Actor) {
  // Process memory -> browser memory only. No JWT-bearing call logs/storageState files.
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

test("participants browse; trusted facilitators manage questions and permanently end a session", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const target = await guard();
  const graphqlUrl = browserGraphql(target);
  const group = await newGroup(target);
  const manager = await actor(group);
  const participant = await actor(group);
  const db = await connect(target);
  const readerContext = await newContext(browser, {
    baseURL: "http://localhost:5173",
    viewport: page.viewportSize(),
  });
  try {
    await setFacilitator(db, manager.id, "grant");
    await manager.refresh();
    for (const ctx of [context, readerContext])
      await ctx.route(`${target.endpoints.auth}/**`, (route) => {
        if (route.request().method() === "POST")
          group.budget.spend(new URL(route.request().url()).pathname.replace(/^\/v1/, ""));
        return route.continue();
      });
    await seed(context, manager);
    await seed(readerContext, participant);
    await page.goto("/workspace");
    const view = page.locator(".view-menu > summary");
    await expect(view).toHaveText("Participant view");
    await view.click();
    const facilitatorView = page.getByRole("link", { name: "Facilitator view", exact: true });
    await facilitatorView.hover();
    await page.mouse.down();
    try {
      // A null focus target during a pointer gesture must not hide its link
      // before mouse-up can dispatch the click that performs navigation.
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await expect(facilitatorView).toBeVisible();
    } finally {
      await page.mouse.up();
    }
    await expect(page).toHaveURL(/\/facilitate$/);
    await expect(view).toHaveText("Facilitator view");
    const name = `Team reflection ${randomUUID()}`;
    await page.getByRole("button", { name: "New retrospective", exact: true }).click();
    await page.getByLabel("Retrospective name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Create retrospective", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByRole("button", { name: "Rename session", exact: true }).click();
    await page.getByLabel("Rename session", { exact: true }).fill(`${name} · October`);
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: `${name} · October` })).toBeVisible();
    const sessionId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByLabel("New question", { exact: true }).fill("What gave us energy?");
    await page.getByRole("button", { name: "Add question", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What gave us energy?" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete session", exact: true }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "Edit question 1", exact: true }).click();
    await page
      .getByLabel("Edit question 1", { exact: true })
      .fill("What helped us do our best work?");
    await page.getByRole("button", { name: "Save question", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "What helped us do our best work?" }),
    ).toBeVisible();
    await page.getByLabel("New question", { exact: true }).fill("Temporary question");
    await page.getByRole("button", { name: "Add question", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Temporary question" })).toBeVisible();
    await page.getByRole("button", { name: "Delete question 2", exact: true }).click();
    const deletion = page.getByRole("dialog", { name: "Delete this question?" });
    await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete question 2", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Delete question 2", exact: true }).click();
    await deletion.getByRole("button", { name: "Delete question 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Temporary question" })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Questions", exact: true })).toBeFocused();

    const reader = await readerContext.newPage();
    const readerRoles: string[] = [];
    reader.on("request", (request) => {
      if (request.url() === graphqlUrl) readerRoles.push(request.headers()["x-hasura-role"]);
    });
    // An unlisted account cannot open a known session URL.
    await reader.goto(`/sessions/${sessionId}`);
    await expect(reader.getByRole("heading", { name: "Session unavailable" })).toBeVisible();
    await page.getByRole("button", { name: /^Participants/ }).click();
    await page
      .getByRole("combobox", { name: "Add participant", exact: true })
      .fill(participant.email);
    await page.getByRole("option").filter({ hasText: participant.email }).click();
    await expect(
      page.getByRole("button", { name: `Remove ${participant.email}`, exact: true }),
    ).toBeVisible();
    await reader.goto(`/sessions/${sessionId}`);
    await expect(
      reader.getByRole("heading", { name: "What helped us do our best work?" }),
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: /Edit question|Add question|End session|Rename session/ }),
    ).not.toBeVisible();
    await reader.goto(`/facilitate/${sessionId}`);
    await expect(reader).toHaveURL(/\/workspace$/);
    expect(readerRoles.every((role) => role === "user")).toBe(true);
    await reader.getByRole("link", { name: new RegExp(name) }).click();

    // A dirty question draft in a stale tab survives the other tab's closure.
    const stale = await context.newPage();
    await stale.goto(`/facilitate/${sessionId}`);
    await stale.getByRole("button", { name: "Edit question 1", exact: true }).click();
    await stale
      .getByLabel("Edit question 1", { exact: true })
      .fill("Keep my unsaved reflection prompt");
    await page.getByRole("button", { name: "End session", exact: true }).click();
    const closing = page.getByRole("dialog", { name: "End this retrospective?" });
    await expect(closing.getByText(/Ending is permanent/)).toBeVisible();
    await expect(closing.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await closing.getByRole("button", { name: "End session", exact: true }).click();
    await expect(page.getByText(/permanently read-only/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: `${name} · October` })).toBeFocused();
    await expect(reader.getByText(/permanently read-only/)).toBeVisible({ timeout: 5_000 });
    await expect(stale.getByLabel("Edit question 1", { exact: true })).toBeDisabled({
      timeout: 5_000,
    });
    await expect(stale.getByLabel("Edit question 1", { exact: true })).toHaveValue(
      "Keep my unsaved reflection prompt",
    );
    await expect(
      page.getByRole("button", { name: /End session|Rename session|Delete question/ }),
    ).not.toBeVisible();
    for (const view of [page, reader, stale])
      expect(
        await view.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    await stale.close();
    const remove = page.getByRole("button", { name: `Remove ${participant.email}`, exact: true });
    await remove.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: `Remove ${participant.email}`, exact: true })
      .click();
    await expect(remove).not.toBeVisible();
    await reader.reload();
    await expect(reader.getByRole("heading", { name: "Session unavailable" })).toBeVisible();
    await reader.close();

    // Empty-only session removal has its own confirmation and a real navigation target.
    await page.getByRole("link", { name: "All retrospectives" }).click();
    const emptyName = `Empty reflection ${randomUUID()}`;
    await page.getByRole("button", { name: "New retrospective", exact: true }).click();
    await page.getByLabel("Retrospective name", { exact: true }).fill(emptyName);
    await page.getByRole("button", { name: "Create retrospective", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(emptyName) }).click();
    await page.getByRole("button", { name: "Delete session", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete session", exact: true })
      .click();
    await expect(page).toHaveURL(/\/facilitate$/);
    await expect(page.getByRole("link", { name: new RegExp(emptyName) })).not.toBeVisible();
    expect(group.budget.email).toBe(0);
    expect(group.budget.signin).toBe(2);
  } finally {
    // Timeout teardown may already have closed it; keep the original failed step.
    await Promise.allSettled([readerContext.close()]);
    await db.end();
    await cleanupActor(target, participant.id);
    await cleanupActor(target, manager.id);
  }
});
