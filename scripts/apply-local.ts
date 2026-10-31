import { applyDeveloper } from "../backend/tests/lib/developer.ts";
import { main } from "../backend/tests/lib/process.ts";
import { noTargetArgs } from "../backend/tests/lib/runner-options.ts";

await main(async () => {
  noTargetArgs(process.argv.slice(2));
  await applyDeveloper();
});
