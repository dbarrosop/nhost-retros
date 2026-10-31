import { setFacilitator } from "../backend/scripts/facilitator.ts";
import { connectDeveloper, developerAccountId } from "../backend/tests/lib/developer.ts";
import { connectLocalOperator } from "../backend/tests/lib/operator-db.ts";
import { assert, main } from "../backend/tests/lib/process.ts";
import { connect, guard, locked } from "../backend/tests/lib/target.ts";

await main(async () => {
  const [action, id, target, ...extra] = process.argv.slice(2);
  assert(
    (action === "grant" || action === "revoke") &&
      id &&
      ["--test-target", "--local-database", "--developer"].includes(target) &&
      !extra.length,
    "Usage: pnpm facilitator <grant|revoke> <account-uuid|developer-email> <--test-target|--local-database|--developer>",
  );
  const run = async () => {
    const db =
      target === "--test-target"
        ? await connect(await guard())
        : target === "--developer"
          ? await connectDeveloper()
          : await connectLocalOperator();
    try {
      await setFacilitator(
        db,
        target === "--developer" ? await developerAccountId(db, id) : id,
        action,
      );
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
