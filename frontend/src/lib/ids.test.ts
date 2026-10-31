import { describe, expect, it } from "vitest";
import { isUuid } from "./ids";

describe("route UUID shape", () => {
  it.each([
    "11111111-1111-4111-8111-111111111111",
    "ABCDEF01-2345-6789-ABCD-EF0123456789",
    "00000000-0000-0000-0000-000000000000",
  ])("accepts canonical UUID %s", (value) => {
    expect(isUuid(value)).toBe(true);
  });
  it.each([
    "not-a-uuid",
    "",
    "11111111-1111-4111-8111-11111111111g",
    "11111111111141118111111111111111",
    " 11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-8111-111111111111\n",
    "11111111-1111-4111-8111-111111111111/extra",
  ])("rejects malformed UUID %j", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
