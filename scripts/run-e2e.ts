import { health, synchronizeMetadata } from "../backend/tests/lib/api.ts";
import { applyMigrations } from "../backend/tests/lib/migrations.ts";
import { main, runSuite } from "../backend/tests/lib/process.ts";
import { e2eEndpoint, e2eEngine } from "../backend/tests/lib/runner-options.ts";
import { freePort, guard, locked } from "../backend/tests/lib/target.ts";

await main(async () => {
  const engine = e2eEngine(process.argv.slice(2));
  await locked(async () => {
    const target = await guard();
    await health(target);
    await freePort(5173);
    await applyMigrations(target);
    await synchronizeMetadata(target);
    // Only public URLs go to Vite. Tokens stay in fixture process memory, not VITE_*.
    await runSuite(["--filter", "@retro/frontend", "exec", "playwright", "test"], {
      ...process.env,
      // Developer HOST overrides must not expose the acceptance server beyond loopback.
      HOST: "localhost",
      VITE_NHOST_AUTH_URL: target.endpoints.auth,
      VITE_NHOST_GRAPHQL_URL: e2eEndpoint(target, engine),
      RETRO_TEST_GRAPHQL_ENGINE: engine,
    });
  });
});
