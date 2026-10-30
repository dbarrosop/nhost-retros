import { assert } from "../tests/lib/process.ts";
import type { connect } from "../tests/lib/target.ts";

type Database = Awaited<ReturnType<typeof connect>>;

// Trusted SQL only. Never expose this function via a browser/API or user metadata.
export async function setFacilitator(db: Database, id: string, action: "grant" | "revoke") {
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    "Expected an account UUID",
  );
  await db.query("BEGIN");
  try {
    const account = await db.query(
      `SELECT default_role, email_verified AND NOT disabled AND NOT is_anonymous
         AND split_part(lower(email::text),'@',2) = 'nhost.io'
         AND email::text ~ '^[^@]+@[^@]+$' AS eligible
       FROM auth.users WHERE id=$1 FOR UPDATE`,
      [id],
    );
    assert(account.rowCount === 1, "Account does not exist");
    if (action === "grant") {
      assert(
        account.rows[0].eligible && account.rows[0].default_role === "user",
        "Grant requires an eligible account with default user role",
      );
      const member = await db.query(
        "SELECT 1 FROM auth.user_roles WHERE user_id=$1 AND role='user'",
        [id],
      );
      assert(member.rowCount === 1, "Grant requires ordinary user membership");
      await db.query(
        "INSERT INTO auth.user_roles(user_id,role) VALUES($1,'facilitator') ON CONFLICT (user_id,role) DO NOTHING",
        [id],
      );
    } else {
      // Revocation remains possible after an account loses eligibility.
      assert(
        account.rows[0].default_role !== "facilitator",
        "Restore default user role before revoking an invalid default facilitator role",
      );
      await db.query("DELETE FROM auth.user_roles WHERE user_id=$1 AND role='facilitator'", [id]);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    if (error instanceof Error && !("severity" in error)) throw error;
    throw new Error("Facilitator operation failed (database details withheld)");
  }
}
