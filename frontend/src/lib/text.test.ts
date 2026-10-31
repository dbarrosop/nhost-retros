import { describe, expect, it } from "vitest";
import { plainText } from "./text";

const whitespace =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
describe("plain text contracts shared with Postgres", () => {
  it("trims the ECMAScript whitespace set and rejects empty content", () => {
    expect(plainText(`${whitespace}hello${whitespace}`, 120)).toBe("hello");
    expect(() => plainText(whitespace, 120)).toThrow("1–120");
    expect(plainText("line one\nline two", 500)).toBe("line one\nline two");
  });
  it.each([120, 500])("counts Unicode code points at the %i boundary", (max) => {
    for (const char of ["x", "😀"]) {
      expect(plainText(char.repeat(max), max)).toBe(char.repeat(max));
      expect(() => plainText(char.repeat(max + 1), max)).toThrow();
    }
    expect(plainText("e\u0301".repeat(max / 2), max)).toBe("e\u0301".repeat(max / 2));
    expect(() => plainText(`${"e\u0301".repeat(max / 2)}x`, max)).toThrow();
    for (const invalid of ["\0", "bad\ud800", "\udc00bad"])
      expect(() => plainText(invalid, max)).toThrow("valid plain text");
  });
});
