import { health } from "../backend/tests/lib/api.ts";
import { main, runSuite } from "../backend/tests/lib/process.ts";
import { freePort, guard, locked } from "../backend/tests/lib/target.ts";

await main(async () =>
  locked(async () => {
    const target = await guard();
    await health(target);
    await freePort(5173);
    // Only public URLs go to Vite. Tokens stay in fixture process memory, not VITE_*.
    runSuite(["--filter", "@retro/frontend", "exec", "playwright", "test"], {
      ...process.env,
      VITE_NHOST_AUTH_URL: target.endpoints.auth,
      VITE_NHOST_GRAPHQL_URL: target.endpoints.graphql,
    });
  }),
);
