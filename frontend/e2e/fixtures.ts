import { type Browser, test as base, expect } from "@playwright/test";
import { e2eEndpoint } from "../../backend/tests/lib/runner-options";
import type { Target } from "../../backend/tests/lib/target";
import { publicAssets } from "./public-assets";

export function browserGraphql(target: Target) {
  const endpoint = e2eEndpoint(target, process.env.RETRO_TEST_GRAPHQL_ENGINE);
  if (process.env.VITE_NHOST_GRAPHQL_URL !== endpoint)
    throw new Error("Browser/API acceptance endpoint mismatch; use pnpm test:e2e");
  return endpoint;
}

export async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext(options);
  await publicAssets(context);
  return context;
}

export const test = base.extend<{ publicAssets: undefined }>({
  publicAssets: [
    async ({ context }, use) => {
      await publicAssets(context);
      await use(undefined);
    },
    { auto: true },
  ],
});
export { expect };
