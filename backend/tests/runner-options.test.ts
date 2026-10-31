import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { e2eEndpoint, e2eEngine, targetAction } from "./lib/runner-options.ts";
import { definition, endpoints } from "./lib/target.ts";

const target = () => ({
  ...definition,
  databaseId: randomUUID(),
  endpoints: endpoints(definition.subdomain, definition.httpPort),
});

describe("acceptance command boundaries", () => {
  it("selects only registered engines and defaults to canonical Constellation", () => {
    const registered = target();
    expect(e2eEngine([])).toBe("constellation");
    for (const engine of ["hasura", "constellation"]) {
      expect(e2eEngine(["--engine", engine])).toBe(engine);
      expect(e2eEndpoint(registered, engine)).toBe(
        engine === "hasura" ? registered.endpoints.hasura : registered.endpoints.graphql,
      );
    }
    for (const engine of [undefined, "", "graphql", "https://remote.nhost.run/v1"])
      expect(() => e2eEndpoint(registered, engine)).toThrow("acceptance engine");
    expect(() => e2eEndpoint({ ...registered, project: "backend" }, "hasura")).toThrow();
    const remote = target();
    remote.endpoints.hasura = "https://remote.nhost.run/v1/graphql";
    expect(() => e2eEndpoint(remote, "hasura")).toThrow();
    for (const args of [
      ["--engine"],
      ["--engine", "remote"],
      ["hasura"],
      ["--engine", "hasura", "--target", "backend"],
    ])
      expect(() => e2eEngine(args)).toThrow("Usage");
  });

  it("refuses extra/unknown target arguments instead of silently destroying a different target", () => {
    for (const action of ["provision", "health", "stop", "destroy"]) {
      expect(targetAction([action])).toBe(action);
      for (const args of [
        [action, "backend"],
        [action, "--target", "https://remote.nhost.run"],
        [action, "--root-folder", "backend"],
      ])
        expect(() => targetAction(args)).toThrow("no target overrides");
    }
    for (const args of [[], ["reset"], ["destroy; echo unsafe"]])
      expect(() => targetAction(args)).toThrow("Usage");
  });
});
