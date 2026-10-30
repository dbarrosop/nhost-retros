import { health } from "../backend/tests/lib/api.ts";
import { migrationRoundtrip } from "../backend/tests/lib/migrations.ts";
import { main } from "../backend/tests/lib/process.ts";
import { guard, locked } from "../backend/tests/lib/target.ts";

await main(async () =>
  locked(async () => {
    const target = await guard();
    await health(target);
    await migrationRoundtrip(target);
  }),
);
