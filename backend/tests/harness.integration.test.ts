import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { health, request, roleSchema } from "./lib/api.ts";
import { actor, cleanupActor, newGroup, proveLimiterReset } from "./lib/auth.ts";
import { scratchDatabase } from "./lib/migrations.ts";
import { assert } from "./lib/process.ts";
import { connect, container, guard, secrets, state } from "./lib/target.ts";

// Ordered, single-worker groups: a reset never races another actor's request.
describe("real disposable Auth/JWT harness", () => {
  it("refuses unmarked, mismatched, remote and wrong-database targets before any reset", async () => {
    const liveFile = join(state, "target.json");
    const saved = readFileSync(liveFile, "utf8");
    const target = await guard();
    const authId = container(target, "auth").Id;
    const directory = mkdtempSync(join(tmpdir(), "retro-guard-"));
    const file = join(directory, "target.json");
    const rejected = async () => {
      let failed = false;
      try {
        await guard(file);
      } catch {
        failed = true;
      }
      assert(failed, "Guard unexpectedly accepted unsafe target");
    };
    try {
      // Never mutate/remove the live registration marker, even briefly.
      await rejected();
      writeFileSync(file, saved, { mode: 0o600 });
      await guard(file);
      for (const change of [
        { project: "backend" },
        { repository: "/wrong" },
        { databaseId: "00000000-0000-0000-0000-000000000000" },
        { endpoints: { ...target.endpoints, auth: "https://remote.nhost.run/v1" } },
      ]) {
        writeFileSync(file, JSON.stringify({ ...target, ...change }), { mode: 0o600 });
        await rejected();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    assert(readFileSync(liveFile, "utf8") === saved, "Guard test changed live registration");
    assert(container(await guard(), "auth").Id === authId, "Rejected target changed Auth process");
    let failed = false;
    try {
      container(target, "intentionally-absent-service");
    } catch {
      failed = true;
    }
    assert(failed, "Absent required service was not a failing prerequisite");
  });

  it("drops only its minted scratch database even when a check throws", async () => {
    const target = await guard();
    let minted = "";
    let failed = false;
    try {
      await scratchDatabase(target, async (name) => {
        minted = name;
        throw new Error("Intentional scratch failure");
      });
    } catch {
      failed = true;
    }
    assert(failed && minted.startsWith("retro_scratch_"), "Scratch failure did not propagate");
    const client = await connect(target);
    try {
      assert(
        (await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [minted])).rowCount === 0,
        "Failed scratch check leaked a database",
      );
    } finally {
      await client.end();
    }
    await guard();
  });

  it("proves per-IP brute-force enforcement and an actual limiter reset", async () => {
    await proveLimiterReset(await guard());
  });

  it("authenticates eligible SQL fixtures once, refreshes, and checks both JWT schemas", async () => {
    const target = await guard();
    await health(target);
    const group = await newGroup(target);
    const fixtures: string[] = [];
    try {
      const first = await actor(group);
      fixtures.push(first.id);
      const second = await actor(group);
      fixtures.push(second.id);
      for (const fixture of [first, second]) {
        await fixture.refresh();
        const claims = JSON.parse(
          Buffer.from(fixture.session.accessToken.split(".")[1], "base64url").toString("utf8"),
        );
        const hasura = claims["https://hasura.io/jwt/claims"];
        assert(
          hasura?.["x-hasura-user-id"] === fixture.id,
          "Real JWT does not identify its fixture",
        );
        assert(hasura?.["x-hasura-default-role"] === "user", "JWT default role mismatch");
        for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
          const fields = await roleSchema(target, url, fixture.session.accessToken, "user", true);
          assert(
            JSON.stringify(fields) ===
              JSON.stringify(url === target.endpoints.hasura ? ["no_queries_available"] : []),
            "Unexpected fields in Phase 2 user schema",
          );
          const invalid = await request(
            target,
            url,
            { query: "query { users { id email } }" },
            { Authorization: `Bearer ${fixture.session.accessToken}`, "x-hasura-role": "user" },
          );
          assert(
            invalid.status >= 400 || Boolean(invalid.body.errors),
            "Fixture unexpectedly has a participant directory",
          );
          const wrongToken = await request(
            target,
            url,
            { query: "query { __typename }" },
            { Authorization: `Bearer ${fixture.session.accessToken.slice(0, -8)}invalid!` },
          );
          assert(
            wrongToken.status >= 400 || Boolean(wrongToken.body.errors),
            "Engine accepted a forged JWT",
          );
        }
      }
      assert(
        group.budget.signin === 2 && group.budget.email === 0,
        "Fixture authentication exceeded its non-email budget",
      );
      assert(Object.keys(secrets()).length === 6, "Unexpected credential set");
    } finally {
      for (const id of fixtures.reverse()) await cleanupActor(target, id);
    }
  });
});
