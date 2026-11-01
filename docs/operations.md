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
pnpm test:e2e                         # canonical Constellation
pnpm test:e2e --engine hasura          # same complete desktop/mobile journeys
```

CI has independent `constellation`/`hasura` acceptance lanes, each with a freshly
provisioned disposable stack. Both lanes run migration roundtrip and the entire
real-JWT backend suite on **both** engines; the lane chooses only the SPA endpoint.
The browser interceptors check that same registered endpoint, so stale-write,
revocation and privacy probes cannot silently watch the other engine. Engine
selection accepts only those two names, not arbitrary URLs. Normal development
still uses Constellation; no product setting or production configuration changes.
No private browser artifacts or generated stack state are uploaded in CI.

`pnpm test` runs the frontend and backend **unit** suites without services.
Integration commands are separate and mandatory in CI. Missing targets, services,
browsers or port 5173 cause failure. Playwright owns a finite Vite subprocess,
never attaches to an existing dev server, and shuts Vite down after the suite.
Stop `pnpm dev` before E2E. Each final desktop/mobile engine run took 3.9 minutes;
Playwright retains its eight-minute global timeout inside the ten-minute outer
runner cap, with no extra browser cases added by developer setup. Frontend and
acceptance CI jobs install Nix and run every install/check/test/cleanup command
through `nix develop -c ...`. The locked flake supplies Node, pnpm, Biome, Nhost CLI
and Playwright's matching Chromium/headless shell, including its browser-path
and runtime-library configuration. No Node/pnpm setup actions, native CLI
installer or separate Playwright browser download are used in CI.
These jobs allow 90 minutes for cold Nix realization plus the tests; this is a
job budget, not a measured cold-run duration. Toolchain caching can be configured
without changing the flake-backed execution path or duplicating version pins.
Hosted execution remains unperformed. Nix formatting/version checks remain a
separate job.
If `nix flake check` reports `running 0 flake checks`, also build the named gates
to verify the derivations, not just successful evaluation. For an aarch64 Linux
host (substitute your host system on other architectures):

```sh
nix build --no-link \
  .#checks.aarch64-linux.nixpkgs-fmt \
  .#checks.aarch64-linux.biome-version \
  .#checks.aarch64-linux.playwright-version
```

## Developer-local setup (no reset)

First distinguish these two developer setups; both are separate from disposable
acceptance and use the **real** `backend-*` stack on HTTPS 443/Postgres 5432:

- **Fresh stack started with this checkout's `nhost up`:** Nhost already applies
  the app SQL and metadata. Skip `pnpm local:apply` and go straight to `pnpm dev`
  and onboarding. Running the helper anyway is expected to refuse “CLI-applied
  local migration lacks a verified checksum”. This is harmless, not a broken
  fresh setup; do not adopt CLI history, reset data or reconcile it just to make
  the optional helper succeed.
- **Already-running stack from before the app migrations:** use the additive
  helper below, before another `nhost up` can independently apply those files.
  It records verified checksums as it runs SQL and mirrors the CLI bookkeeping.

For the existing **pre-migration** stack, from repository cwd:

```sh
pnpm install --frozen-lockfile
pnpm local:apply
pnpm dev
```

The app at <http://localhost:5173> defaults to `VITE_NHOST_SUBDOMAIN=local` and
`VITE_NHOST_REGION=local`. The SDK derives Auth
`https://local.auth.local.nhost.run/v1` and canonical Constellation
`https://local.graphql.local.nhost.run/v1` from those values. No `.env.local` is
needed for the defaults; set the two project values for another local/cloud
project. Optional service-URL overrides take precedence and must point to the
intended developer stack.
The setup script does not start a persistent frontend server. Stop it with Ctrl+C
when you start `pnpm dev` yourself; the execution parent may manage that process.

`backend/tests/lib/developer.ts` verifies local Docker transport, this repository's
exact `backend/.nhost/docker-compose.yaml` labels, published ports, metadata mount
and matching Docker/network Postgres system identity. It pins network requests to
loopback, validates HTTPS certificates, never accepts remote/path/project overrides
and loads privileged credentials privately from existing container configuration.
It does not overwrite configuration/secrets, call `nhost up`, stop/reset Auth,
drop data, or run down SQL. Only Constellation is recreated to read current metadata.

Before connecting to Postgres or making a backup, the helper reads Hasura CLI
`migrate status` once through the validated developer console service. Every
checked-in version must have an unambiguous, clean status; missing/dirty status
or unknown versions fail before SQL or backup creation. Before changes it streams
a complete database dump and exports metadata into
`backend/.nhost/retro-backups/<time>-<pid>/` (ignored; directory 0700/files 0600).
These backups include private Auth data: never attach, log, commit or serve them.
Keep them protected until the change is verified; restore is an explicit operator
procedure, not an automated reset. The helper uses an advisory lock and atomic
up-SQL/checksum ledger entries in `retro_local_operations.migrations`, with bounded
SQL lock/statement timeouts. It validates **all** migration checksums and the CLI
applied set before creating a ledger or starting any migration transaction. If
CLI reports a version applied but the ledger lacks its verified checksum, setup
refuses: it neither adopts that version nor replays its SQL/backfill nor inserts
a ledger entry. Pinned `nhost up` can apply new SQL independently of this helper,
so CLI state must be checked as well as the checksum ledger. Hasura receives only
retro-table metadata changes;
all unrelated tables, sources, permissions and source configuration are retained.
Metadata replacement uses the exported resource version to reject concurrent edits.
A failed later metadata/readiness check can be retried with `pnpm local:apply`:
committed migrations are checksum-verified, not replayed. No reset is necessary.
After successful checks, the helper mirrors only those committed versions into
standard Hasura CLI state using `migrate apply --skip-execution` and verifies
`migrate status`. This is bookkeeping only: the pinned `nhost up` automatically
applies migrations on future starts, so leaving its state unaware of the custom
checksum ledger would incorrectly replay already-applied SQL. Unknown/dirty or
ambiguous CLI status fails closed; SQL is never replayed to repair that state.
A ledger-verified version not yet mirrored into CLI state is safe to skip and
mirror; a version applied by CLI alone is **not** safe to adopt automatically.

This helper requires an already running, correctly configured local project.
It refuses an unrecorded existing retro schema/role, edited migration history or
unknown newer ledger entries rather than guessing adoption or resetting data.
For an existing stack with unexpectedly mixed/ambiguous histories, CLI-applied
but unrecorded versions require explicit, backed-up operator reconciliation of
the actual SQL/history outside this helper before retrying. A fresh stack with
all SQL/metadata already applied by Nhost needs no helper retry or reconciliation;
leave its CLI-only history alone and use the app normally.
Do not clear either history or rerun a backfill to bypass the refusal; preserve
existing data and review any necessary forward migration. The
Constellation mount remains the checked-in metadata directory; unrelated custom
Hasura metadata is preserved, not automatically exported into Constellation.
These limits do not block this repository's verified local setup.

For actual account onboarding, choose **Create account** in the app and enter
your email address (any domain). Open <https://local.mailhog.local.nhost.run>, select
the latest message addressed to you and copy the six-digit code from its body.
Mailhog captures locally; no external SMTP/production URL is required. Use a
browser GET for its UI: Mailhog can return 404 to HEAD despite serving GET normally.
Keep OTPs private. Requesting a sign-in OTP can also create an account; email
verification is still required before it can access application data.

After verification, a trusted local operator runs:

```sh
pnpm facilitator grant you@example.com --developer
pnpm facilitator revoke you@example.com --developer  # when needed
```

`--developer` uses the same verified local connection without a password assignment.
It accepts a UUID or a trimmed case-normalized email from any domain, requires an
existing account, and delegates eligibility/locking/default-user preservation to
the same tested operator transaction. It never creates users or grants roles via
Auth signup/browser metadata. Refresh/sign in again (or focus the SPA) after a
grant; use **Facilitator workspace**. Revocation affects old JWTs immediately at
the data layer. The additive helper does not create accounts or grants. First
local Nhost startup also applies the checked-in demo seed; on an existing stack,
add `--apply-seeds` to the usual startup command without changing its project,
subdomain or port flags. The seed provisions `factilitator@acme.local` as a trusted
facilitator plus fictional participants and example retrospectives. It is for
local development only; see [the seed instructions](../README.md#local-demo-seed).
Never apply demo users/grants to production.

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

All integration/reset runners, including first provisioning, hold an exclusive
`.local-test/run.lock`. Do not run Auth groups or browser suites concurrently.
Nhost startup and every provisioning/reset Compose call use async, finite owned
process groups: startup has a five-minute cap, Compose a four-minute outer cap
(and its shorter `--wait-timeout`), then a five-second TERM-to-KILL grace. Timeout,
SIGINT and SIGTERM kill owned descendants even when they hold inherited pipes;
startup cleanup runs and `finally` releases the lock. CLI output stays private.
Only an uncatchable SIGKILL, host crash or an older runner may leave a stale lock:
verify its recorded PID and owned descendants are no longer runners before
removing **only** `.local-test/run.lock`. Never kill processes by a broad name or
delete developer volumes to fix a test.

```sh
pnpm test:target stop       # Registered test services only; retains test data
pnpm test:target provision  # Resume/reconcile the registered project
pnpm test:target destroy    # Requires a running, identity-verified target;
                           # removes only its Compose resources/volumes/state
```

For a fresh-reset replay, first pass `health`, then `stop`, `provision`, `health`,
`destroy`, and `provision` in that order, followed by all checks above plus
`pnpm lint`, `pnpm typecheck`, `pnpm test`, the frontend build and `nix flake check`.
`destroy` removes **all retained fixtures on this registered disposable target**;
do not substitute a developer project. Stop/resume retains data; destroy/recreate
must mint a new database identity and new throwaway keys. Acceptance entrypoints
reject extra target/path arguments rather than ignoring them. Guard unit tests
also prove every mutating test/reset wrapper stops before side effects when registration is
missing or rejected; the real-JWT harness verifies remote/mismatched marker and
wrong-database refusal without modifying live registration. See
[acceptance evidence](acceptance.md) for the measured local replay.

Resume stopped services before `destroy`. For a **registered partial startup**,
including an older interrupted run that left ports on `0.0.0.0`, rerun
`pnpm test:target provision`; do not edit Compose or bypass `guard`. Before any
resume startup it validates registration, Docker labels, reserved port map and
the same database volume, idempotently corrects the generated Compose bindings,
and starts only the proven Postgres/Traefik resources. A running database proves
identity before this repair; a stopped one proves identity immediately after
its guarded startup and before Auth/metadata changes. The unchanged strict
loopback/network/database guards must then pass. The same correction/rebind also
runs after `nhost up`, **including failures/signals**, so cleanup cannot leave
registered public bindings blocking the next resume. `stop`/`destroy` remain
strict: recover with `provision`, then `health`, before using them. Ownership,
volume, unexpected port or identity mismatch still refuses recovery. No CLI
automatic down-on-error is used; retain ownership evidence for repair instead.

If provisioning fails before registration, `provisioning.json` preserves the
reserved project identity for startup cleanup, but no reset command trusts it. Inspect/reconcile that local failed attempt explicitly; do not
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
with an old JWT. Changing the email domain alone does not revoke access.

## Auth fixture and rate budgets

Auth accepts any email domain and allows implicit OTP signup. Email verification
is required, anonymous accounts stay disabled, the signup default is `user`, and
only `user,me` are signup-requestable. The local redirect allowlist also includes
the development network origin. Runtime checks verify the Auth policy and rate
limits. No production limiter overlay is used.

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

Fixtures SQL-create enabled, verified, non-anonymous `@acme.local` users with a
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
Auth policy groups are separate: seven email paths for arbitrary-domain signup,
rejected role requests and implicit-account sign-in; two email paths/five sign-in/verify requests
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
- The generated developer Compose file has project-relative bind mounts. Every
  developer Compose refresh must also pass `--project-directory <repo>/backend`;
  `--file <repo>/backend/.nhost/docker-compose.yaml` alone resolves them under
  `.nhost`, silently mounting an empty `nhost/metadata` tree. The additive wrapper
  validates the actual mount and passes the explicit directory. Disposable
  Compose files already use their own rewritten absolute paths. An earlier
  misresolved refresh may leave an unused root-owned empty
  `backend/.nhost/nhost/metadata` directory. It is not mounted after reconciliation
  and does not block the app; leave it alone unless its owner explicitly cleans
  up the confirmed empty directory. Never remove `.nhost` or volumes to fix it.
- Keep copied metadata directory inodes alive when services have bind mounts.
  Deleting/recreating a mounted directory can leave running containers observing
  the deleted tree and make a subsequent `nhost up` unhealthy. The provisioner
  copies in place; Constellation is explicitly recreated after metadata refresh.
- `docker compose restart` has no `--wait` in the pinned environment. Runners use
  `up --detach --no-deps --force-recreate --wait --wait-timeout` for bounded resets.
  Container health does **not** mean Traefik has registered the recreated route:
  disposable runners probe routed Auth `GET /healthz` or GraphQL `__typename`
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

Use **Create account** on the sign-in page for a new account, then enter
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
Auth, queries, mutation guards and workspace notices share TanStack's optimistic,
event-driven `onlineManager`. The browser's `navigator.onLine` is only a hint:
its false LAN/loopback values cannot block startup, refresh retries or new writes
forever. Actual offline/online events still pause/cancel reads and resume them;
failed requests use the existing bounded retry/error handling, never queued writes.

The isolated Mailhog URL is recorded under `endpoints.mail` in the non-secret
`.local-test/target.json`. Never use external SMTP for local acceptance. Auth
0.52.0 intentionally returns HTTP 200 for unknown-account OTP sign-in; assertions
must check **no session and no new DB row**, not require a 4xx. Mailhog HTML has
six-digit CSS colors, so extract an OTP only from standalone element text, never
the first six-digit substring. These are measured pinned-version behaviors.

After applying the checked-in role migration to the chosen local backend, a
trusted SQL operator can run these commands from repo root:

```sh
# Existing developer stack; no credential assignment needed (UUID also accepted):
pnpm facilitator grant you@example.com --developer
pnpm facilitator revoke you@example.com --developer

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
the default workspace remains participant-only. Production backend provisioning
and facilitator administration remain separate operator responsibilities. Tests
touch only the separately registered disposable database, never the developer stack.

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

- Vitest caches mock-factory exports across `resetModules`. Recovery tests keep
  one per-suite temporary repository path and recreate only its contents per
  case; changing the mocked path per case can leave imports pointing to a deleted
  sandbox. Never let these tests fall back to the real `.local-test` directory.
- Vitest entrypoint tests use literal dynamic-import loader functions. A variable
  relative `import(path)` was resolved from the transformed test root instead of
  the source file and never exercised the wrapper. Keep literal imports so the
  test actually reaches the mocked guard, and assert it was called.
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
  The public-only Vite bridge in `e2e/public-assets.ts` strips credentials and
  makes no retries. Context teardown can reject its fetch with the explicit
  `route.fetch: Request context disposed.` lifecycle error while request failure
  is still unset; recognize that disposal independently of page-close events.
  Keep ordinary transport errors failing with sanitized diagnostics. Unit tests
  cover both cancellation and genuine failure paths.
- GraphQL race probes must send exactly the variables declared in each document.
  An unused variable can be rejected before reaching SQL, falsely appearing to prove
  authorization and never exercising the intended lock wait.
- jsdom lacks native modal methods. Unit setup supplies only open/close state;
  real modal top-layer behavior and focus restoration are Playwright assertions.
  Elements outside an open modal are inert: set post-confirm focus only after
  `dialog.close()`, not inside the awaited mutation callback. Disabling a focused
  text field/button also blurs it in Chromium; pending forms keep controls
  focusable using read-only/aria-disabled plus a submit guard.

## Production checklist (frontend deployment available)

See [the frontend deployment instructions](../README.md#deploy-frontend-to-cloudflare-workers)
for `make deploy-frontend`, the existing `nhost-app` dispatch namespace, and the
`FRONTEND_DOMAIN` override (default `retros.nhost.app`). This target publishes only
the frontend; it never changes backend configuration/data or shared infrastructure.

Local acceptance needs none of the following operator values. Actual production
deployment and onboarding remain unperformed until the operator supplies and
reviews them; never guess backend URLs or commit credentials.

### Operator-supplied configuration

- Approved HTTPS SPA, Auth and canonical Constellation GraphQL origins, valid TLS,
  DNS and a static host. Build with `VITE_NHOST_SUBDOMAIN` and `VITE_NHOST_REGION`
  for the Nhost project. Use optional `VITE_NHOST_AUTH_URL` and
  `VITE_NHOST_GRAPHQL_URL` overrides only for custom endpoints; all four are public
  build-time inputs, not runtime secrets.
  Confirm the deployed bundle targets the approved backend, not localhost. No
  admin secret, database URL, signing key or SMTP password belongs in any `VITE_*`
  variable, static file, source map, CI artifact or browser storage.
- Auth client URL, explicit allowed redirects and **exact** SPA CORS origins for
  Auth and both GraphQL engines. The checked-in backend is a local development
  config (`corsDomain=['*']`, Hasura `devMode=true`, `enableConsole=true`); do not
  deploy it unchanged. Use a separately reviewed production configuration with
  dev mode/console disabled, metadata/config/pgdump APIs restricted to operators,
  TLS and no public database, Mailhog, dashboard or development console. Keep
  introspection/role schemas consistent with tested permissions; hiding a UI or
  root field is never authorization.
- A custom SMTP provider, sender identity, credentials delivered through the
  secret manager, verified delivery and team-scale quota/capacity. Review Auth's
  project-wide email/IP limits before onboarding; the local ten-email/hour
  configuration and default email service are unsuitable for a team rollout.
  Do not weaken verification/role checks to accommodate quotas. Local
  Mailhog and limiter resets are disposable-only, never production workarounds.
- A backup owner, protected encrypted storage, retention policy, restore access
  and a maintenance window for SQL changes. Back up the complete database
  (including Auth, app data and grants), metadata, configuration and required
  secrets separately; protect these like production data. Rehearse restoration
  into an isolated environment before rollout. Record engine/CLI/image versions
  and the release revision; an untested dump is not a recovery plan.

Preserve required verification, disabled anonymous accounts, default `user` and
signup-requestable `user,me`. Email domains are unrestricted; OTP requests may
create accounts, but unverified accounts have no application access.
`facilitator` must never become signup-requestable or the default. Check live
eligibility/membership permissions on **both** engines after configuration changes.
Do not enable unrelated Auth providers or storage permissions as part of rollout.

### Static host and backend-first rollout

The checked-in Worker configuration implements the static-host behavior below:
Cloudflare handles SPA navigations and existing assets before the 404 fallback,
with immutable hashed assets and revalidated HTML. No API proxy is deployed.

1. Serve the Vite `frontend/dist` build over HTTPS. Rewrite application navigations
   (for example `/sessions/<uuid>` and `/facilitate/<uuid>/questions/<uuid>`) to
   `index.html` with a successful status, while preserving real static assets and
   returning missing assets as errors. Do not rewrite API origins. Cache hashed
   assets immutably, but revalidate the HTML so stale clients receive releases.
   Test direct deep-link reloads, not just navigation from `/`.
2. Take/rehearse the backup, record current grants and obtain change approval.
   Apply reviewed **up** migrations to the explicitly chosen production database
   through the operator's established privileged migration tooling, then apply
   metadata with zero inconsistencies. The guarded `test:*` commands intentionally
   cannot target production. Recreate/reload Constellation's metadata snapshot as
   required by its pinned version; Hasura metadata success alone is insufficient.
3. Before publishing the new frontend, verify both role schemas and real-JWT
   controls: eligible participant reads, two-user private multi-card isolation,
   denied forged facilitator header and live revoked membership, closure rejecting
   later content writes, and facilitator-only grouping after closure. Use approved
   synthetic accounts/data: ended smoke-test content is intentionally retained.
   Never log JWTs, OTPs or admin responses.
4. Publish the static frontend with the approved public URLs. Smoke-test HTTPS
   OTP delivery/verification, restoration/signout, two-browser five-second updates,
   mobile/keyboard Move-to, closed-session read-only state and deep-link fallback.
   Inspect browser requests for the expected explicit role and canonical endpoint.
   Stop onboarding on failed authorization or freeze checks; do not mask them by
   switching engines or loosening permissions.
5. Provision a small set of trusted facilitators through approved SQL access.
   The repository's `pnpm facilitator` command deliberately supports **local**
   targets only; it is not a cloud administration client. The equivalent operator
   transaction must validate/lock the eligible account, retain `user` as default,
   and insert/delete only its `auth.user_roles` facilitator membership. The
   implementation in `backend/scripts/facilitator.ts` is the reference. Refresh
   the JWT after a grant; revocation must deny an already-issued JWT immediately.

### Rollback and retained accounts

Prefer a compatible previous static frontend and reviewed metadata rollback,
retaining database schema, data and trusted grants. Do not restore an older broad
permission set or remove live eligibility checks. If schema compatibility is not
known, pause writes/onboarding and forward-fix; database restoration requires the
backup owner, an explicit outage/data-loss decision and a tested recovery plan.
Application `down.sql` files are exercised only in disposable scratch databases:
they drop application data and are **not** a production rollback recipe. Role down
also refuses existing facilitator grants/defaults; never delete grants just to
force a downgrade through. Preserve the independent grouping/frozen-content
boundary during any compatible rollback and rerun both-engine smoke checks.

Answer-to-author foreign keys deliberately prevent account deletion once answers
exist, including privileged SQL deletion. There is no hidden cascade or general
maintenance bypass. Retire an account by disabling access, revoking refresh
sessions and facilitator membership without erasing its retained cards. Any
retention/deletion request requires a separate explicit, backed-up and reviewed
operator procedure addressing immutable ended content, author identity and legal
retention; this MVP supplies no account-deletion UI or destructive cleanup tool.
