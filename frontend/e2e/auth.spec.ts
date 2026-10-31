import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { cleanupActor, newGroup } from "../../backend/tests/lib/auth";
import { latestCode } from "../../backend/tests/lib/mail";
import { connect, guard } from "../../backend/tests/lib/target";

test("verified OTP signup, wrong code, resend, restoration, signout and sign-in", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const target = await guard();
  const group = await newGroup(target);
  const email = `browser-${randomUUID()}@nhost.io`;
  const statuses: number[] = [];
  // Navigation/load and a hidden connection notice do not mean that the lock-gated
  // refresh has finished. Observe its response without reading/logging credentials.
  const nextRotation = (tab: Page) =>
    tab.waitForResponse(
      (response) =>
        response.url() === `${target.endpoints.auth}/token` &&
        response.request().method() === "POST",
    );
  let pendingRotation: { page: Page; started: () => void; gate: Promise<void> } | undefined;
  await context.route(`${target.endpoints.auth}/**`, async (route) => {
    if (route.request().method() === "POST")
      group.budget.spend(new URL(route.request().url()).pathname.replace(/^\/v1/, ""));
    const pending = pendingRotation;
    if (
      pending &&
      route.request().url() === `${target.endpoints.auth}/token` &&
      route.request().frame().page() === pending.page
    ) {
      pendingRotation = undefined;
      pending.started();
      await pending.gate;
    }
    return route.continue();
  });
  context.on("response", (response) => {
    if (response.url().startsWith(target.endpoints.auth)) statuses.push(response.status());
  });
  const fillCode = async (code: string) => {
    // Avoid OTP-bearing Playwright call logs, even on assertion failure.
    await page.locator("#otp").evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, code);
  };
  // Clock installation is context-wide: do it before any application timers exist.
  await page.clock.install();
  try {
    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Company email").fill(`  ${email.toUpperCase()}  `);
    await page.getByRole("button", { name: "Create account & send code" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByLabel("One-time code")).toBeFocused();
    const initialCode = await latestCode(target, email);
    await fillCode(initialCode === "000000" ? "000001" : "000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("alert")).toContainText("invalid, expired or already used");
    // Advance only the resend interval, then remove the wall-clock skew before
    // JWT expiry arithmetic, reload and second-tab restoration. Auth clocks never change.
    await page.clock.fastForward(31_000);
    await page.getByRole("button", { name: "Resend code", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("A new code is on its way");
    await page.clock.setSystemTime(Date.now());
    await fillCode(await latestCode(target, email));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to the team space." })).toBeVisible();
    await expect(page.getByText("Signed in as a participant.")).toBeVisible();
    // A transient restoration failure must not turn a still-valid account into a signed-out UI.
    await page.route(
      `${target.endpoints.auth}/token`,
      (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
      { times: 1 },
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welcome to the team space." })).toBeVisible();
    await expect(page.getByRole("status", { name: "Session connection" })).toContainText(
      "retry automatically",
    );
    const reconnected = nextRotation(page);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const connection = await reconnected;
    expect(connection.status()).toBe(200);
    await connection.finished();
    await expect(page.getByRole("status", { name: "Session connection" })).not.toBeVisible();
    const other = await context.newPage();
    let releaseRotation!: () => void;
    const rotationGate = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    let rotationStarted!: () => void;
    const rotating = new Promise<void>((resolve) => {
      rotationStarted = resolve;
    });
    // Deterministically exercise navigation finishing before restoration: keep the
    // real token request pending until the loading shell has been checked.
    pendingRotation = { page: other, started: rotationStarted, gate: rotationGate };
    const restored = nextRotation(other);
    try {
      await other.goto("/workspace");
      await rotating;
      await expect(other.getByText("Checking your session…", { exact: true })).toBeVisible();
      releaseRotation();
      const restoration = await restored;
      expect(restoration.status()).toBe(200);
      await restoration.finished();
      await expect(other.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    } finally {
      releaseRotation();
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(other.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await other.close();
    await page.getByLabel("Company email").fill(email);
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await fillCode(await latestCode(target, email));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to the team space." })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("nhostSession") === null)).toBe(true);
    expect(statuses.includes(429)).toBe(false);
    expect(group.budget.email).toBe(3);
    expect(group.budget.signin).toBe(5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    const db = await connect(target);
    try {
      const result = await db.query("SELECT id FROM auth.users WHERE email=$1", [email]);
      for (const row of result.rows) await cleanupActor(target, row.id);
    } finally {
      await db.end();
    }
  }
});
