import { expect, test } from "vitest";
import worker from "./worker";

test("unmatched non-navigation requests return 404 instead of the SPA shell", async () => {
  const response = worker.fetch();
  expect(response.status).toBe(404);
  expect(response.headers.get("Content-Type")).not.toContain("text/html");
  expect(await response.text()).toBe("Not Found");
});
