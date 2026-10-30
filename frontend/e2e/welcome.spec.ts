import { expect, test } from "@playwright/test";

test("welcome is readable, keyboard-accessible and fits the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Make space for better work." }),
  ).toBeVisible();
  await expect(
    page.getByText("For verified @nhost.io accounts. A one-time code is all you need."),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.getByRole("link", { name: "What to expect" }).click();
  await expect(
    page.getByRole("heading", { name: "Less ceremony. More understanding." }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("unknown paths offer a working return home", async ({ page }) => {
  await page.goto("/not-a-retro");
  await expect(page.getByRole("heading", { name: "This page isn’t here." })).toBeVisible();
  await page.getByRole("link", { name: "Back to welcome" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make space for better work.");
});
