import { setFacilitator } from "../../backend/scripts/facilitator";
import { actor, cleanupActor, newGroup } from "../../backend/tests/lib/auth";
import { connect, guard } from "../../backend/tests/lib/target";
import { expect, newContext, test } from "./fixtures";

test("fresh browser contexts boot the facilitator workspace without losing entry modules", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const target = await guard(),
    group = await newGroup(target),
    manager = await actor(group),
    db = await connect(target);
  let sessionId: string | undefined;
  try {
    await setFacilitator(db, manager.id, "grant");
    await manager.refresh();
    sessionId = (
      await db.query("INSERT INTO retro_sessions(name) VALUES('Workspace readiness') RETURNING id")
    ).rows[0].id;
    // One sign-in per actor; each context adopts the last context's rotated token.
    // Exercise actual first-load/StrictMode paths, not reloads, retries or sleeps.
    for (let load = 0; load < 24; load++) {
      const context = await newContext(browser, { baseURL: "http://localhost:5173" });
      try {
        await context.route(`${target.endpoints.auth}/**`, (route) => {
          if (route.request().method() === "POST")
            group.budget.spend(new URL(route.request().url()).pathname.replace(/^\/v1/, ""));
          return route.continue();
        });
        const claims = JSON.parse(
          Buffer.from(manager.session.accessToken.split(".")[1], "base64url").toString(),
        );
        await context.addInitScript(
          (session) => {
            localStorage.setItem("nhostSession", JSON.stringify(session));
          },
          {
            ...manager.session,
            decodedToken: { ...claims, exp: claims.exp * 1000, iat: claims.iat * 1000 },
          },
        );
        const page = await context.newPage();
        const failures: string[] = [];
        page.on("pageerror", (error) => failures.push(error.name));
        page.on("requestfailed", (request) => {
          const url = new URL(request.url());
          // StrictMode intentionally aborts the first API query; this assertion
          // concerns entry resources, not legitimate private-request cancellation.
          if (url.origin === "http://localhost:5173")
            failures.push(`${url.pathname}: ${request.failure()?.errorText}`);
        });
        await page.goto(`/facilitate/${sessionId}`);
        try {
          await expect(
            page.getByRole("button", { name: "End session", exact: true }),
          ).toBeVisible();
        } catch (error) {
          throw new Error(`Workspace bootstrap ${load + 1} failed: ${failures.join(", ")}`, {
            cause: error,
          });
        }
        expect(failures).toEqual([]);
        manager.session = await page.evaluate(() => {
          const session = localStorage.getItem("nhostSession");
          if (!session) throw new Error("Workspace lost its session during startup");
          return JSON.parse(session);
        });
      } finally {
        await Promise.allSettled([context.close()]);
      }
    }
    expect(group.budget.email).toBe(0);
    expect(group.budget.signin).toBe(1);
  } finally {
    // Only this active, empty fixture can be removed; frozen content is never bypassed.
    if (sessionId) await db.query("DELETE FROM retro_sessions WHERE id=$1", [sessionId]);
    await db.end();
    await cleanupActor(target, manager.id);
  }
});
