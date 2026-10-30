import { setFacilitator } from "../backend/scripts/facilitator.ts";
import { connectLocalOperator } from "../backend/tests/lib/operator-db.ts";
import { assert, main } from "../backend/tests/lib/process.ts";
import { connect, guard, locked } from "../backend/tests/lib/target.ts";

await main(async () => {
  const [action, id, target, ...extra] = process.argv.slice(2);
  assert(
    (action === "grant" || action === "revoke") &&
      id &&
      ["--test-target", "--local-database"].includes(target) &&
      !extra.length,
    "Usage: pnpm facilitator <grant|revoke> <account-uuid> <--test-target|--local-database>",
  );
  const run = async () => {
    const db =
      target === "--test-target" ? await connect(await guard()) : await connectLocalOperator();
    try {
      await setFacilitator(db, id, action);
    } finally {
      await db.end();
    }
    console.log(
      `Facilitator ${action} complete; refresh/sign in to update JWT roles. Default user role retained.`,
    );
  };
  if (target === "--test-target") await locked(run);
  else await run();
});
