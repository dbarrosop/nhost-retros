import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrations } from "./lib/migrations.ts";
import { connect, guard } from "./lib/target.ts";

it("admits verified accounts from any domain while retaining live eligibility and rollback", async () => {
  const db = await connect(await guard());
  const migration = migrations().find((item) =>
    item.name.endsWith("_retro_unrestricted_email_domains"),
  );
  if (!migration) throw new Error("Missing unrestricted-email migration");
  const cases = [
    { domain: "acme.local", eligible: true },
    { domain: "example.com", eligible: true },
    { domain: "team.nhost.io", eligible: true },
    { domain: "nhost.io.example.com", eligible: true },
    { domain: "nhost.io", eligible: true },
    { verified: false, eligible: false },
    { disabled: true, eligible: false },
    { anonymous: true, eligible: false },
    { defaultRole: "me", eligible: false },
    { roles: ["facilitator"], eligible: false },
    { defaultRole: "facilitator", roles: ["user", "facilitator"], eligible: true },
  ];
  try {
    await db.query("BEGIN");
    await db.query(migration.up);
    for (const scenario of cases) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO auth.users(id,email,locale,default_role,email_verified,disabled,is_anonymous)
         VALUES($1,$2,'en',$3,$4,$5,$6)`,
        [
          id,
          `${id}@${scenario.domain ?? "acme.local"}`,
          scenario.defaultRole ?? "user",
          scenario.verified ?? true,
          scenario.disabled ?? false,
          scenario.anonymous ?? false,
        ],
      );
      for (const role of scenario.roles ?? ["user"])
        await db.query("INSERT INTO auth.user_roles(user_id,role) VALUES($1,$2)", [id, role]);
      const eligible = async () =>
        (await db.query("SELECT id FROM retro_eligible_users WHERE id=$1", [id])).rows;
      expect(await eligible()).toEqual(scenario.eligible ? [{ id }] : []);
      await db.query(migration.down);
      expect(await eligible()).toEqual(
        scenario.eligible && scenario.domain === "nhost.io" ? [{ id }] : [],
      );
      await db.query(migration.up);
      expect(await eligible()).toEqual(scenario.eligible ? [{ id }] : []);
    }
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
