import { randomBytes, randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import { assertAuthConfig, type Reply, request, waitForRoute } from "./api.ts";
import { assert } from "./process.ts";
import { compose, connect, container, guard, type Target } from "./target.ts";

export class Budget {
  email = 0;
  signin = 0;
  total = 0;
  spend(path: string) {
    assert(++this.total <= 80, "Auth group exceeded total request budget");
    if (
      [
        "/signup/otp/email",
        "/signin/otp/email",
        "/signup/email-password",
        "/user/email/change",
        "/user/email/send-verification-email",
        "/user/password/reset",
      ].includes(path)
    ) {
      assert(
        ++this.email <= 8,
        "Auth group exceeded eight email-path requests (including rejected requests)",
      );
    }
    if (path.startsWith("/signin") || path.endsWith("/verify")) {
      assert(++this.signin <= 8, "Auth group exceeded eight sign-in/verify requests");
    }
  }
}

export async function resetAuth(target: Target) {
  await guard();
  assertAuthConfig(target);
  const old = container(target, "auth").Id;
  // This pinned Auth uses the in-process store; a shared memcache would need a different reset.
  assert(
    !container(target, "auth").Config.Env.some(
      (item) =>
        item.startsWith("AUTH_RATE_LIMIT_MEMCACHE_SERVER=") &&
        item !== "AUTH_RATE_LIMIT_MEMCACHE_SERVER=",
    ),
    "Unexpected persistent Auth limiter; reset contract invalid",
  );
  compose(target, [
    "up",
    "--detach",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
    "auth",
  ]);
  assert(
    container(target, "auth").Id !== old,
    "Auth reset did not recreate the disposable process",
  );
  assertAuthConfig(target);
  await waitForRoute(target, "auth");
}

// Intentionally isolated from normal auth-policy/OTP groups. No email is sent.
export async function proveLimiterReset(target: Target) {
  await resetAuth(target);
  const invalid = {
    email: "missing-rate-probe@nhost.io",
    password: randomBytes(18).toString("hex"),
  };
  for (let count = 0; count < 11; count++) {
    const reply = await request(target, `${target.endpoints.auth}/signin/email-password`, invalid);
    assert(
      reply.status === (count < 10 ? 401 : 429),
      "Pinned per-IP brute-force limiter did not enforce its configured burst",
    );
  }
  await resetAuth(target);
  const reply = await request(target, `${target.endpoints.auth}/signin/email-password`, invalid);
  assert(reply.status === 401, "Auth recreation did not reset the exhausted limiter");
}

type Session = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: { id: string; defaultRole: string; roles: string[]; email: string };
};
type SignIn = { session?: Session };

export class AuthGroup {
  readonly budget = new Budget();
  readonly target: Target;
  constructor(target: Target) {
    this.target = target;
  }

  async post<T = Record<string, unknown>>(path: string, body: unknown): Promise<Reply<T>> {
    this.budget.spend(path);
    const response = await request<T>(this.target, `${this.target.endpoints.auth}${path}`, body);
    assert(response.status !== 429, "Unexpected Auth 429; stop, do not retry or skip");
    return response;
  }
}

export type Actor = {
  id: string;
  email: string;
  session: Session;
  refresh: () => Promise<Session>;
};

export async function actor(group: AuthGroup): Promise<Actor> {
  const id = randomUUID();
  const email = `fixture-${id}@nhost.io`;
  const password = randomBytes(24).toString("hex");
  const client = await connect(group.target);
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO auth.users(id,email,display_name,email_verified,disabled,is_anonymous,default_role,password_hash,locale) VALUES($1,$2,$3,true,false,false,'user',$4,'en')",
      [id, email, "Disposable participant", hashSync(password, 10)],
    );
    await client.query("INSERT INTO auth.user_roles(user_id,role) VALUES($1,'user'),($1,'me')", [
      id,
    ]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Fixture SQL creation failed (details withheld)");
  } finally {
    await client.end();
  }
  try {
    const reply = await group.post<SignIn>("/signin/email-password", { email, password });
    assert(
      reply.status === 200 && reply.body.session?.accessToken,
      "Fixture sign-in failed (response withheld)",
    );
    const session = reply.body.session;
    assert(
      session.user.id === id &&
        session.user.defaultRole === "user" &&
        !session.user.roles.includes("facilitator"),
      "Fixture roles are not least-privileged",
    );
    const fixture: Actor = {
      id,
      email,
      session,
      async refresh() {
        const refreshed = await group.post<Session>("/token", {
          refreshToken: fixture.session.refreshToken,
        });
        assert(
          refreshed.status === 200 && refreshed.body.accessToken,
          "Fixture token refresh failed (response withheld)",
        );
        fixture.session = refreshed.body;
        return fixture.session;
      },
    };
    return fixture;
  } catch (error) {
    await cleanupActor(group.target, id);
    throw error;
  }
}

export async function cleanupActor(target: Target, id: string) {
  const client = await connect(target);
  try {
    await client.query("DELETE FROM auth.users WHERE id=$1", [id]);
  } finally {
    await client.end();
  }
}

export async function newGroup(target: Target) {
  await resetAuth(target);
  return new AuthGroup(target);
}
