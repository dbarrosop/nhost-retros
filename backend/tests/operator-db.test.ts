import { describe, expect, it } from "vitest";
import { localOperatorOptions } from "./lib/operator-db.ts";

describe("trusted operator loopback boundary", () => {
  it("rejects missing, remote and query-overridden database targets before connecting", () => {
    for (const value of [
      undefined,
      "not a URL",
      "postgres://operator@remote.test/local",
      "postgres://operator@localhost/local?host=remote.test",
      "postgres://operator@127.0.0.1/local#override",
      "https://operator@localhost/local",
      "postgres://localhost/local",
      "postgres://operator@localhost/",
    ]) {
      expect(() => localOperatorOptions(value)).toThrow();
    }
  });
  it("pins localhost to loopback and treats connection values only as data", () => {
    expect(localOperatorOptions("postgres://operator@localhost:5432/local")).toEqual({
      host: "127.0.0.1",
      port: 5432,
      user: "operator",
      password: "",
      database: "local",
      connectionTimeoutMillis: 5000,
      ssl: false,
    });
  });
});
