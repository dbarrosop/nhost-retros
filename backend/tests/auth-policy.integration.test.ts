import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { setFacilitator } from "../scripts/facilitator.ts";
import { assertAuthConfig, request, roleSchema } from "./lib/api.ts";
import { actor, cleanupActor, newGroup } from "./lib/auth.ts";
import { latestCode } from "./lib/mail.ts";
import { assert } from "./lib/process.ts";
import { connect, guard } from "./lib/target.ts";

const denied = (status: number) => status >= 400 && status < 500 && status !== 429;

describe("company OTP policy and trusted roles (ordered groups)", () => {
  it("rejects external, subdomain, lookalike domains and requestable role/defaultRole elevation", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const prefix = `policy-${randomUUID()}`;
    const cases = [
      { email: `${prefix}@example.com` },
      { email: `${prefix}@team.nhost.io` },
      { email: `${prefix}@nhost.io.example.com` },
      { email: `${prefix}@nhоst.io` }, // Cyrillic o
      { email: `${prefix}@nhost.io`, options: { allowedRoles: ["user", "facilitator"] } },
      { email: `${prefix}@nhost.io`, options: { defaultRole: "facilitator" } },
    ];
    for (const body of cases) {
      const reply = await group.post("/signup/otp/email", body);
      assert(
        denied(reply.status),
        `Auth must reject domain/role escalation (status ${reply.status})`,
      );
    }
    const implicit = await group.post("/signin/otp/email", { email: `${prefix}@nhost.io` });
    // Pinned Auth deliberately returns OK for unknown accounts to avoid enumeration.
    assert(
      implicit.status === 200 && !implicit.body.session,
      "Unknown-account sign-in returned a session",
    );
    const db = await connect(target);
    try {
      assert(
        (await db.query("SELECT 1 FROM auth.users WHERE email::text LIKE $1", [`${prefix}%`]))
          .rowCount === 0,
        "Rejected Auth request created an account",
      );
    } finally {
      await db.end();
    }
    assert(group.budget.email === 7, "Auth policy request budget changed");
    assertAuthConfig(target);
  });

  it("requires verification, rejects wrong/expired/reused codes, and ignores metadata role claims", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const email = `otp-policy-${randomUUID()}@nhost.io`;
    const db = await connect(target);
    let id = "";
    try {
      const signup = await group.post("/signup/otp/email", {
        email,
        options: {
          metadata: {
            role: "facilitator",
            allowedRoles: ["facilitator"],
            defaultRole: "facilitator",
          },
        },
      });
      assert(
        signup.status === 200 && !signup.body.session,
        "Signup must not return an unverified session",
      );
      const user = await db.query(
        "SELECT id,email_verified,default_role FROM auth.users WHERE email=$1",
        [email],
      );
      assert(
        user.rowCount === 1 && !user.rows[0].email_verified && user.rows[0].default_role === "user",
        "Signup verification/default role policy changed",
      );
      id = user.rows[0].id;
      const code = await latestCode(target, email);
      const verify = (otp: string) =>
        group.post<{
          session?: {
            accessToken: string;
            refreshToken: string;
            user: { emailVerified: boolean; roles: string[]; defaultRole: string };
          };
        }>("/signin/otp/email/verify", { email, otp });
      const wrong = await verify(code === "000000" ? "000001" : "000000");
      assert(denied(wrong.status), "Wrong code was accepted");
      await db.query(
        "UPDATE auth.users SET otp_hash_expires_at=now()-interval '1 minute' WHERE id=$1",
        [id],
      );
      const expired = await verify(code);
      assert(denied(expired.status), "Expired code was accepted");
      const resent = await group.post("/signin/otp/email", { email });
      assert(resent.status === 200, "OTP resend failed");
      const latest = await latestCode(target, email);
      const verified = await verify(latest);
      const session = verified.body.session;
      assert(
        verified.status === 200 && session?.accessToken && session.user.emailVerified,
        "OTP did not verify account and issue a session",
      );
      assert(
        session.user.defaultRole === "user" && !session.user.roles.includes("facilitator"),
        "Metadata escalated trusted roles",
      );
      const reused = await verify(latest);
      assert(denied(reused.status), "Reused OTP was accepted");
      await db.query("UPDATE auth.users SET disabled=true WHERE id=$1", [id]);
      const disabled = await group.post("/token", { refreshToken: session.refreshToken });
      assert(denied(disabled.status), "Disabled account refreshed its session");
      assert(group.budget.email === 2 && group.budget.signin === 5, "OTP policy budget changed");
    } finally {
      await db.end();
      if (id) await cleanupActor(target, id);
    }
  });

  it("grants/revokes only trusted eligible users, retains default user, and refreshes JWT claims", async () => {
    const target = await guard();
    const group = await newGroup(target);
    const fixture = await actor(group);
    const db = await connect(target);
    try {
      for (const [verified, disabled, anonymous, email] of [
        [false, false, false, fixture.email],
        [true, true, false, fixture.email],
        [true, false, true, fixture.email],
        [true, false, false, "outside@example.com"],
        [true, false, false, "outside@sub.nhost.io"],
      ]) {
        await db.query(
          "UPDATE auth.users SET email_verified=$2,disabled=$3,is_anonymous=$4,email=$5 WHERE id=$1",
          [fixture.id, verified, disabled, anonymous, email],
        );
        let failed = false;
        try {
          await setFacilitator(db, fixture.id, "grant");
        } catch {
          failed = true;
        }
        assert(failed, "Ineligible account received facilitator grant");
        await db.query(
          "UPDATE auth.users SET email_verified=true,disabled=false,is_anonymous=false,email=$2 WHERE id=$1",
          [fixture.id, fixture.email],
        );
      }
      const original = fixture.session.accessToken;
      await setFacilitator(db, fixture.id, "grant");
      await setFacilitator(db, fixture.id, "grant");
      await fixture.refresh();
      const granted = fixture.session.accessToken;
      assert(
        fixture.session.user.roles.includes("facilitator") &&
          fixture.session.user.defaultRole === "user",
        "Grant refresh did not retain user default/add facilitator",
      );
      const claims = (token: string) =>
        JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())[
          "https://hasura.io/jwt/claims"
        ]["x-hasura-allowed-roles"] as string[];
      assert(
        !claims(original).includes("facilitator") && claims(granted).includes("facilitator"),
        "Grant changed an old JWT or did not change refreshed claims",
      );
      await setFacilitator(db, fixture.id, "revoke");
      await setFacilitator(db, fixture.id, "revoke");
      await fixture.refresh();
      assert(
        !fixture.session.user.roles.includes("facilitator") &&
          fixture.session.user.defaultRole === "user" &&
          !claims(fixture.session.accessToken).includes("facilitator"),
        "Revoke refresh retained privileges",
      );
      for (const url of [target.endpoints.hasura, target.endpoints.graphql]) {
        // Probe role acceptance, not an inaccessible table (which errors even for a valid role).
        const probe = (token: string, role: string) =>
          request<{
            data?: { __typename: string };
            errors?: { message: string; extensions?: { code?: string } }[];
          }>(
            target,
            url,
            { query: "query { __typename }" },
            { Authorization: `Bearer ${token}`, "x-hasura-role": role },
          );
        for (const [token, role] of [
          [original, "user"],
          [fixture.session.accessToken, "user"],
          [granted, "facilitator"],
        ]) {
          const reply = await probe(token, role);
          assert(
            reply.status === 200 &&
              (url === target.endpoints.hasura
                ? Boolean(reply.body.data?.__typename) && !reply.body.errors
                : reply.body.errors?.length === 1 &&
                  reply.body.errors[0].message === `no schema available for role: ${role}`),
            "Positive control: JWT role was not accepted",
          );
        }
        for (const token of [original, fixture.session.accessToken]) {
          const reply = await probe(token, "facilitator");
          assert(
            url === target.endpoints.hasura
              ? reply.status === 200 &&
                  !reply.body.data &&
                  reply.body.errors?.[0]?.extensions?.code === "access-denied"
              : reply.status === 401,
            "Fake facilitator header was not rejected at role authorization",
          );
        }
        for (const role of ["user", "me", "facilitator"]) {
          const fields = await roleSchema(target, url, granted, role, true);
          assert(
            fields.every((field) => field === "no_queries_available"),
            "Internal/trusted role unexpectedly gained app access",
          );
        }
      }
    } finally {
      await db.end();
      await cleanupActor(target, fixture.id);
    }
  });
});
