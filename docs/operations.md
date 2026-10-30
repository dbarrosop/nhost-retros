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

There are currently **zero application migrations/roles**. This is an exercised
Auth baseline/roundtrip/cleanup gate, not a claim that future role/content migrations
or grant-refusal tests have passed. Add their assertions when those migrations
are introduced. Before app permissions exist, Hasura's user query schema contains
only `no_queries_available`; Constellation explicitly reports no schema for user.
The real-JWT harness checks those exact contracts without adding fake app access.

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
users are removed after checks. Future non-OTP browser journeys should seed the
SDK session in memory from these fixtures; only dedicated OTP journeys spend the
separate email budget. Mailhog is isolated in this test project, not external SMTP.

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

## Production (deferred)

No deployment is performed here. Before production onboarding, the operator must
supply approved HTTPS frontend/backend URLs, redirects/CORS and custom SMTP with
team-scale capacity. Never guess these or commit credentials. Hosting/SPA fallback,
backup/rollback and facilitator provisioning runbooks will be completed with the
relevant application slices and final operational acceptance.
