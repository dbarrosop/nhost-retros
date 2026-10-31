import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrations } from "./lib/migrations.ts";
import { connect, guard } from "./lib/target.ts";

it("accepts facilitator defaults without weakening live account or membership checks", async () => {
  const target = await guard();
  const db = await connect(target);
  const migration = migrations().find((item) =>
    item.name.endsWith("_retro_application_default_roles"),
  );
  if (!migration) throw new Error("Missing application-default-role migration");
  const cases = [
    { name: "participant", defaultRole: "user", roles: ["user"], eligible: true },
    {
      name: "facilitator",
      defaultRole: "facilitator",
      roles: ["user", "facilitator"],
      eligible: true,
      facilitator: true,
    },
    {
      name: "default-is-not-a-grant",
      defaultRole: "facilitator",
      roles: ["user"],
      eligible: true,
    },
    { name: "internal-default", defaultRole: "me", roles: ["user"], eligible: false },
    { name: "no-user-membership", roles: ["facilitator"], eligible: false },
    { name: "unverified", verified: false, eligible: false },
    { name: "disabled", disabled: true, eligible: false },
    { name: "anonymous", anonymous: true, eligible: false },
    { name: "external", domain: "example.test", eligible: false },
    { name: "subdomain", domain: "sub.nhost.io", eligible: false },
  ];
  const ids = new Map<string, string>();
  const eligible = async (id: string | undefined) =>
    (await db.query("SELECT id,is_facilitator FROM retro_eligible_users WHERE id=$1", [id])).rows;
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO auth.roles(role) VALUES('facilitator') ON CONFLICT DO NOTHING");
    await db.query(migration.up);
    for (const scenario of cases) {
      const account = await db.query(
        `INSERT INTO auth.users(email,locale,default_role,email_verified,disabled,is_anonymous)
         VALUES($1,'en',$2,$3,$4,$5) RETURNING id`,
        [
          `${randomUUID()}@${scenario.domain ?? "nhost.io"}`,
          scenario.defaultRole ?? "facilitator",
          scenario.verified ?? true,
          scenario.disabled ?? false,
          scenario.anonymous ?? false,
        ],
      );
      const id = account.rows[0].id as string;
      ids.set(scenario.name, id);
      for (const role of scenario.roles ?? ["user", "facilitator"]) {
        await db.query("INSERT INTO auth.user_roles(user_id,role) VALUES($1,$2)", [id, role]);
      }
      expect(await eligible(id), scenario.name).toEqual(
        scenario.eligible ? [{ id, is_facilitator: scenario.facilitator ?? false }] : [],
      );
    }

    const manager = ids.get("facilitator");
    await db.query("DELETE FROM auth.user_roles WHERE user_id=$1 AND role='facilitator'", [
      manager,
    ]);
    expect(await eligible(manager)).toEqual([{ id: manager, is_facilitator: false }]);

    await db.query(migration.down);
    expect(await eligible(manager)).toEqual([]);
    expect(await eligible(ids.get("participant"))).toHaveLength(1);
    await db.query(migration.up);
    expect(await eligible(manager)).toEqual([{ id: manager, is_facilitator: false }]);
  } finally {
    // All DDL, synthetic accounts and grants are confined to this disposable transaction.
    await db.query("ROLLBACK");
    await db.end();
  }
});
