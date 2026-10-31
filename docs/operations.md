# Local acceptance operations

Run every command from the repository root. This runbook is local-only; it does
not deploy, link a cloud project, or need production SMTP/URLs. The developer
`backend-*` services on HTTPS 443/Postgres 5432 are **not disposable**.

## Prerequisites and commands

- Node 24.22.1, pnpm 12.3.4, Nhost CLI **1.51.2**, a local Unix-socket Docker daemon
  and Docker Compose with `up --wait`. `nix develop` supplies the pinned tools;
  start Docker separately. Remote Docker contexts/hosts are refused.
- Playwright npm **1.61.1**, with its matching Chromium and headless shell.
  `nix develop` exports `PLAYWRIGHT_BROWSERS_PATH` from the pinned **nixpkgs**
  driver, not `nhost.playwright-driver` (that overlay currently has a different
  version). On a supported non-Nix Linux host, run
  `pnpm --filter @retro/frontend exec playwright install --with-deps chromium`;
  `pnpm test:browsers` installs Chromium without OS packages. Do not use a random
  system Chrome or skip a missing-browser prerequisite.

```sh
pnpm install --frozen-lockfile
pnpm test:target provision
pnpm test:target health
pnpm test:migrations
pnpm test:backend
pnpm test:e2e
```

`pnpm test` runs the frontend and backend **unit** suites without services.
Integration commands are separate and mandatory in CI. Missing targets, services,
browsers or port 5173 cause failure. Playwright owns a finite Vite subprocess,
never attaches to an existing dev server, and shuts Vite down after the suite.
Stop `pnpm dev` before E2E. CI uses `nix develop` for identical CLI/browser pins.
If `nix flake check` reports `running 0 flake checks`, also build the named gates
to verify the derivations, not just successful evaluation. For an aarch64 Linux
host (substitute your host system on other architectures):

```sh
nix build --no-link \
  .#checks.aarch64-linux.nixpkgs-fmt \
  .#checks.aarch64-linux.biome-version \
  .#checks.aarch64-linux.playwright-version
```

## Isolation and destructive-operation boundary

Provisioning creates a reserved `retro-test-<repository-path-hash>` Compose project,
`retrotest<hash>` subdomain, branch-independent `disposable` volumes, and a separate
`.local-test/` state folder. It reserves HTTP **18080** and Postgres **55432**; it
fails on conflicts rather than borrowing the developer stack. Published ports are
rebound to **127.0.0.1** after Nhost's bootstrap (the CLI initially publishes on
all interfaces); only use provisioning on a trusted local host. The application
configuration, Auth settings and original `backend/.secrets` are never overwritten.

The ignored, mode-0700 `.local-test` contains:

- `target.json`: repository realpath, reserved project, state path, exact endpoints,
  database name/ports and a random database identity; no credentials.
- `project/.secrets`: mode-0600 throwaway random secrets and a matching RSA JWT
  keypair. `backend/.secrets.example` lists names only. Never copy developer secrets.
- `runtime/`: generated Compose/configuration files, which **contain secrets**.
- `auth-baseline.json`: schema-only Auth dump, baseline role rows and extension
  versions captured from the pinned stack before application SQL, bound to its
  Auth/Postgres image IDs and database identity. No participant data/passwords.

Guards validate the marker, local Docker transport, Compose project/file labels,
loopback ports/volume namespace, and database identity through both Docker psql
and the network Postgres connection. Fixed reserved definitions reject remote,
wrong-repository, ordinary developer, modified, and unmarked targets. There is no
arbitrary endpoint registration or automatic localhost consent. This implementation
always provisions a second stack instead of supporting developer-stack opt-in.
Guard refusal tests use temporary marker copies; they never overwrite or remove
`target.json`, so interruption cannot corrupt the live registration.

All integration/reset runners hold an exclusive `.local-test/run.lock`. Do not run
Auth groups or browser suites concurrently. A forced process termination may leave
a lock: check the recorded PID is no longer a test runner before manually removing
**only** `.local-test/run.lock`. Never delete developer volumes to fix a test.

```sh
pnpm test:target stop       # Registered test services only; retains test data
pnpm test:target provision  # Resume/reconcile the registered project
pnpm test:target destroy    # Requires a running, identity-verified target;
                           # removes only its Compose resources/volumes/state
```

Resume stopped services before `destroy`. If provisioning fails before registration,
`provisioning.json` preserves the intended project identity, but no reset command
will trust it. Inspect/reconcile that local failed attempt explicitly; do not
fabricate a marker or substitute the developer target. When pinned Auth/Postgres
images change, destroy the old healthy disposable target and provision fresh;
baselines from a different image are deliberately rejected.

## Migrations and metadata

Provisioning copies the existing checked-in configuration, retaining all Auth
policy/provider/redirect settings. Bootstrap tracks only existing Auth/storage
metadata, omits application migrations/seeds, captures the pinned Auth baseline,
then applies application `up.sql` files once using a disposable-only ledger and
loads **current repository metadata**. It requires zero Hasura inconsistencies,
recreates Constellation with its refreshed metadata mount and checks both engines.
The CLI itself is not treated as proof of health/success. Applied migration
checksums reject edited history; use a fresh disposable target or a new migration.
Migration files must not contain top-level transaction control: the application
runner owns the transaction that applies SQL and records its checksum together.

`pnpm test:migrations` creates a randomly named `retro_scratch_<20 hex>` database
using template0 in that verified test Postgres. It installs the pinned citext and
pgcrypto extensions, restores the schema-only baseline/role rows, then performs
up/down/up. Normalized full scratch-schema dumps and Auth roles must match the
baseline after down and the first application after reapply. Cleanup runs even on
failure and drops **only** the minted scratch database. Neither live API database
receives `down.sql`. Database identifiers are allowlisted random names and quoted
with pg's identifier escaper (Postgres does not accept parameters for identifiers).

The first migration registers `facilitator` in `auth.roles`, granting nobody
membership. Scratch checks exercise up/down/up and prove down refuses an existing
grant without removing it. The next migration adds sessions/questions, locking
triggers and the live eligibility view. `user` and trusted `facilitator` JWTs now
have explicit app read schemas on both engines; only facilitators have management
mutations. Internal `me` still has no app schema (Hasura's empty-role stub versus
Constellation's missing-role response). No role can select the eligibility view
or an Auth directory. Live SQL membership revocation denies facilitator data even
with an old JWT; external email changes also deny existing and refreshed JWTs.

## Auth fixture and rate budgets

The production Auth configuration stays unchanged: exact `nhost.io`, verification
required, no anonymous accounts/implicit signup, default `user`, signup-requestable
`user,me`; existing providers and redirects remain. Runtime checks verify these
values and the configured rate limits. No production limiter overlay is used.

The pinned Auth 0.52.0 uses an in-process limiter when no memcache server is
configured. Each backend run first exhausts the **non-email** per-IP sign-in burst
(ten rejected password requests, then a required 429), recreates only the registered
test Auth container, and verifies the next request is again a 401. This empirically
proves reset behavior. Every subsequent ordered group recreates Auth and verifies
its process ID changed, policy is unchanged and no persistent limiter is configured.
A changed reset/store contract is a failure requiring a new validated disposable-only
strategy, never weakening the checked-in Auth policy.

Normal groups use `AuthGroup`/`Budget`, counting **before** sending, including
rejections: at most eight email-path requests, eight sign-in/verify requests, and
80 total requests per reset. The throttle proof is its own explicit eleven-request
non-email group, not an auth-policy or OTP group. Unexpected 429s fail immediately;
there are no retry/wait loops. Tests use one worker and the runner lock.

Fixtures SQL-create enabled, verified, non-anonymous `@nhost.io` users with a
bcrypt password and explicit `user,me` membership. This Auth version requires
`locale='en'` on SQL fixtures (there is no database default). Each actor makes one
non-email `/signin/email-password` request and reuses `/token` refresh thereafter.
This is test-only, not a password UI. Tokens/passwords stay in process memory;
no repository token cache, storageState, traces, screenshots or video is written.
Assertions use sanitized messages instead of comparing secret values. Fixture
users without answers are removed after checks. Authors retained by answer foreign
keys are instead disabled, have refresh sessions removed and facilitator membership
revoked; their cards and author records remain until guarded target destruction. Non-OTP browser journeys seed SDK session storage
from these in-memory fixtures; only dedicated OTP journeys spend the separate
email budget. Seed once per browser context, not per tab: the SPA rotates refresh
tokens, so replaying the original token into a later tab invalidates its session.
No storageState files are written. Mailhog is isolated in this test project, not
external SMTP.

OTP acceptance now uses real signup/sign-in/verification and Mailhog on desktop
and mobile. Each browser group spends three email-path requests and five
sign-in/verify requests (signup, wrong code, resend, verification, later sign-in).
Auth policy groups are separate: seven email paths for rejected domains/role
requests plus unknown-account sign-in; two email paths/five sign-in/verify requests
for wrong/expired/reused-code and metadata-escalation checks. Disabled-account
refresh, fake facilitator headers and grant/revoke JWT refreshes are also tested.
Role-header denial probes use `__typename`, not an inaccessible table (which can
fail even when the role is accepted). They require Hasura's `access-denied` code
and Constellation HTTP 401, with accepted user/granted-facilitator controls.
For internal roles without app permissions, Constellation returns HTTP 200 with
`no schema available for role: <role>`; that is distinct from role denial.
Application roles instead have a positive `__typename` control on both engines.
All groups remain sequential and fail unexpected 429s.

Public test URLs are supplied explicitly as `VITE_NHOST_AUTH_URL` and
`VITE_NHOST_GRAPHQL_URL` by `pnpm test:e2e`; no admin/key/password is sent to Vite.
The browser uses Chromium's local host-resolver mapping for `*.local.nhost.run`,
and Node API requests pin these exact registered origins to 127.0.0.1 without
redirects. Custom subdomains do not consistently resolve in public DNS. HTTP is
used only for this loopback disposable stack; the developer HTTPS stack is unchanged.

## Pinned CLI troubleshooting

- CLI 1.51.2 needs **all three explicit absolute paths**: `--root-folder` for
  secrets, `--nhost-folder` for configuration, and `--dot-nhost-folder` for state.
  `--root-folder backend` alone does not relocate configuration lookup. Wrappers
  always run from repository cwd and pass project/subdomain/branch as argv data.
- Keep copied metadata directory inodes alive when services have bind mounts.
  Deleting/recreating a mounted directory can leave running containers observing
  the deleted tree and make a subsequent `nhost up` unhealthy. The provisioner
  copies in place; Constellation is explicitly recreated after metadata refresh.
- `docker compose restart` has no `--wait` in the pinned environment. Runners use
  `up --detach --no-deps --force-recreate --wait --wait-timeout` for bounded resets.
  Container health does **not** mean Traefik has registered the recreated route:
  runners then probe routed Auth `GET /healthz` or the GraphQL `__typename` query
  until JSON success (at most ten probes and 25 seconds). Pinned Auth's healthy
  response is the JSON string `"OK"`, not an object. Only these readiness probes
  retry; counted sign-in/email requests and mutations never do.
- Empty exported `metrics_config: {}` is not valid input to Hasura replace_metadata.
  The loader omits empty optional objects, expands YAML includes and translates
  `allow_list.yaml` to the API's `allowlist` key.
- Nhost/SQL subprocess output is intentionally withheld because it can echo
  credentials. Inspect only the restricted local state when diagnosing failures;
  never paste secrets, Compose config or JWT-bearing logs into reports/artifacts.

## Accounts and trusted local facilitator provisioning

Use **Create account** on the sign-in page for a new company account, then enter
the six-digit email code. **Sign in** never creates accounts implicitly. Emails
are trimmed/lowercased; exact-domain checks run in the form and Auth. There is no
password/reset/OAuth surface. A 30-second browser resend cooldown is a usability
aid, not a security boundary: server rate limits remain unchanged. Wrong, expired
and used codes retain the input and offer resend. Session tokens live only in SDK
session storage; no private Query cache is persisted. Signing out immediately
clears local access and caches; a failed server revoke is explicitly reported.
Only a 401 refresh rejection or an ineligible session deletes the stored session,
matching the SDK's refresh behavior. Network errors, timeouts, 5xx and 429 retain
its refresh token even after JWT expiry: the account shell stays visible with a
reconnecting notice, while expired-JWT private queries are canceled/cleared once
and `canQuery` becomes false until a successful refresh. Retry backoff doubles
from one second to a ten-second cap; online/focus/visibility events can retry
immediately. An unexpired eligible JWT keeps its existing queries during transient
failures. Explicit **Sign out** is the way to forget this browser's session.

The isolated Mailhog URL is recorded under `endpoints.mail` in the non-secret
`.local-test/target.json`. Never use external SMTP for local acceptance. Auth
0.52.0 intentionally returns HTTP 200 for unknown-account OTP sign-in; assertions
must check **no session and no new DB row**, not require a 4xx. Mailhog HTML has
six-digit CSS colors, so extract an OTP only from standalone element text, never
the first six-digit substring. These are measured pinned-version behaviors.

After applying the checked-in role migration to the chosen local backend, a
trusted SQL operator can run these commands from repo root:

```sh
# Identity-verified registered disposable target; credentials loaded privately:
pnpm facilitator grant <account-uuid> --test-target
pnpm facilitator revoke <account-uuid> --test-target

# Explicit local developer database (no reset and never used by test runners):
# First load FACILITATOR_DATABASE_URL securely into this process environment.
pnpm facilitator grant <account-uuid> --local-database
pnpm facilitator revoke <account-uuid> --local-database
```

`FACILITATOR_DATABASE_URL` is a privileged **non-VITE** PostgreSQL URL with SQL user,
database and optional password/port. It must name localhost/127.0.0.1/::1 directly;
query overrides, remote hosts and alternate protocols are refused. `localhost` is
pinned to loopback, not DNS. Do not paste credential assignments into shared logs
or commit them. The command prints only the operation result, not account emails
or connection values. It changes only the requested role membership, in a
transaction with a locked account row; it never resets accounts or volumes.

Grant requires an existing verified, enabled, non-anonymous exact-domain account,
default role `user` and ordinary user membership. Grants/revokes are idempotent;
revocation still works after eligibility is lost. The command never changes the
default role or accepts user metadata as authority. `facilitator` is not in the
signup-requestable roles. Refresh/re-sign-in (or focus the existing SPA) to obtain
new JWT claims. Use **Facilitator workspace** for session/question management;
the default workspace remains participant-only. Production provisioning/deployment
remains deferred. Tests touch only the separately registered disposable database,
never the developer stack.

## Session lifecycle and acceptance fixtures

Eligible accounts can browse every active and ended session and its questions.
Only trusted facilitators manage content. End confirmation is irreversible: a
closed session cannot be renamed, reopened or deleted, and its questions cannot
be added/edited/deleted. Answer cards also become immutable. Database triggers lock
before inspecting closure, so concurrent/stale API writes cannot bypass this rule.
Empty-only deletion and restrictive foreign keys prevent accidental cascades.
The facilitator-only board is available from each question before and after
ending. Use the grip to drag with mouse, touch or keyboard, or use the always
available Move-to menu; topics remain editable after closure.

The UI counts Unicode code points, not JavaScript UTF-16 length. SQL applies the
same explicit whitespace trimming set: names allow 1–120 code points, questions
1–500 and answer cards 1–4,000. Dirty card/question/rename drafts survive polling
and failed writes. Closure
leaves unsaved text visible but disabled. Confirmations start on Cancel; native
`dialog.close()` precedes focus restoration (removal alone loses focus in Chromium).

`pnpm test:backend` proves eligibility/role revocation and CRUD on both engines,
then observes actual Postgres blocking relationships for both closure lock orders
and rollback. Synthetic ended sessions intentionally remain in the disposable
API database, since ordinary SQL cannot erase frozen content. To clear all test
fixtures, use only the registered target's guarded destroy/provision lifecycle;
do not disable triggers or delete developer data. Scratch migration down/up is
still confined to its minted database. `pnpm test:e2e` applies current migrations
and metadata independently and checks desktop/mobile management and read-only
participant flows, including multiple private cards, cross-tab closure and draft
retention. Participant card reads omit author IDs; facilitators may read all cards
and author IDs but cannot edit/delete others’ content. For their own participation,
facilitators follow the session’s participant link, which sends the ordinary user
role. The facilitator API additionally exposes only retained-answer authors'
IDs, display names and emails; participants cannot select or filter by this
projection or grouping relationships.

### Facilitator grouping API

`retroTopics` supports insert (`questionId`, `name`), rename (`name` only) and
delete. Topic names use the same trimming/code-point rules as session names
(1–120). `retroAnswerTopics` supports insert (`answerId`, `questionId`, `topicId`),
move (`topicId` only), and delete (Ungrouped). An answer has at most one assignment;
composite foreign keys reject cross-question/session targets. Topic/assignment
identities and parents cannot change. All operations require the explicit
`facilitator` role plus live eligibility/membership, even with a previously issued
JWT. `user`/`me` have no grouping/author schema or aggregates.

Grouping does not update answer text, authorship or timestamps and remains writable
after closure. Topic deletion removes only assignments; cards become Ungrouped.
An active answer deletion cleans its assignment; an empty active question deletion
cleans its topics. Retained answers still prevent question/account deletion.

Use explicit assignment insert/update/delete rather than relying on upsert.
Duplicate insert and deleted-destination insert/move fail; missing-row update/delete
returns zero affected rows. A committed destination deletion after a move cleans
that assignment. Concurrent moves serialize, with the last successful write winning.
Refetch the board on errors/zero rows; do not automatically replay moves or parse
Hasura/Constellation error strings. Crafted `on_conflict` is tested on both engines:
only `topicId` is updateable, and the same composite integrity constraints apply.
The browser board uses these explicit operations with pending state, authoritative
refetch and sanitized failure feedback. Topic deletion requires confirmation.

Answer-to-question and answer-to-author foreign keys are intentionally restrictive.
Deleting an account with retained cards fails, even for a trusted SQL operator;
there is no content cascade or maintenance bypass. Retention/deletion work needs an
explicit, backed-up operator procedure, not trigger disabling in routine cleanup.

### Browser harness pitfalls

- Out-of-tree Playwright/Vitest harnesses need a neighboring `package.json` with
  `"type": "module"` to match this repository's ESM setup.
- Navigation completion is not session readiness: restoration waits for
  `nhostSessionLock` and a real `/token` response. In OTP tests, register the
  response waiter before reconnect/navigation, assert success/completion without
  reading credentials, then assert the signed-in UI. A promise-gated response
  covers the pending shell deterministically; do not mask the boundary with
  sleeps, retries or larger UI timeouts. Install Playwright's context-wide clock
  before application timers exist, and realign its resend-only wall-clock advance
  before verifying tokens or opening another tab. Put temporary token gates in
  the context-wide budget handler so each real request is counted and handled
  exactly once. In pinned Playwright 1.61.1, layering a page-specific one-shot
  gate with `route.fallback()` over that handler produced `Route is already
  handled` failures; use one route owner, not overlapping response handlers.
- Chromium’s local host-resolver mapping does not apply to Playwright `route.fetch`
  (Node APIRequestContext). Use `route.continue` for real browser traffic and passive
  response capture when replaying a stale read. APIRequestContext failures can print
  Authorization headers; never use it with fixture JWTs or persist those diagnostics.
- GraphQL race probes must send exactly the variables declared in each document.
  An unused variable can be rejected before reaching SQL, falsely appearing to prove
  authorization and never exercising the intended lock wait.
- jsdom lacks native modal methods. Unit setup supplies only open/close state;
  real modal top-layer behavior and focus restoration are Playwright assertions.
  Elements outside an open modal are inert: set post-confirm focus only after
  `dialog.close()`, not inside the awaited mutation callback. Disabling a focused
  text field/button also blurs it in Chromium; pending forms keep controls
  focusable using read-only/aria-disabled plus a submit guard.

## Production (deferred)

No deployment is performed here. Before production onboarding, the operator must
supply approved HTTPS frontend/backend URLs, redirects/CORS and custom SMTP with
team-scale capacity. Never guess these or commit credentials. Hosting/SPA fallback,
backup/rollback and facilitator provisioning runbooks will be completed with the
relevant application slices and final operational acceptance.
