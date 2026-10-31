import { health, synchronizeMetadata } from "../backend/tests/lib/api.ts";
import { applyMigrations } from "../backend/tests/lib/migrations.ts";
import { main, runSuite } from "../backend/tests/lib/process.ts";
import { noTargetArgs } from "../backend/tests/lib/runner-options.ts";
import { guard, locked } from "../backend/tests/lib/target.ts";

await main(async () => {
  noTargetArgs(process.argv.slice(2));
  await locked(async () => {
    const target = await guard();
    await health(target);
    await applyMigrations(target);
    await synchronizeMetadata(target);
    await runSuite([
      "--filter",
      "@retro/backend-tests",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
    ]);
  });
});
