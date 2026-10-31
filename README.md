# Retro

A calm retrospective workspace for your team. Built with React, TypeScript,
TanStack Router and TanStack Query, backed by Nhost Auth and GraphQL.

## Current slice

Verified email OTP signup/sign-in, restoration and cross-tab signout lead to
shared active/ended retrospectives and their questions. Participants add multiple
private reflection cards per question and edit/delete only their own active cards;
operator-provisioned facilitators create, rename, delete empty sessions, manage
questions and permanently end conversations. Backend permissions recheck live
account eligibility and trusted membership; database locks freeze closed content
even for stale/concurrent clients. Verified accounts from any email domain are admitted;
no password UI exists. Facilitators open a per-question reflection board with
author-labelled cards, named topics, mouse/touch/keyboard dragging and a Move-to
menu on every card. Topic management and grouping stay available after ending;
facilitators never edit another person’s answer content. Participants cannot enter
or query this board.
Welcome prompts remain editorial, not participant content. The welcome screen
alone needs no backend; accounts and retrospectives need a migrated local stack.

## Local development

Run all commands from the repository root. Use Node **24.22.1** (`.node-version`)
and pnpm **12.3.4** (`packageManager`); `nix develop` provides the pinned repo tools.
If pnpm is not installed, enable Corepack with `corepack enable` first.

```sh
pnpm install --frozen-lockfile
# Choose the backend preparation path below before starting the frontend.
pnpm dev
```

Open <http://localhost:5173>. Vite dev/preview bind to `HOST`, defaulting to
`localhost`; for example, `HOST=0.0.0.0 pnpm dev` allows access from other devices.
Only use a non-loopback host on a trusted network. Vite **fails** if port 5173 is
occupied rather than silently selecting another port. Stop it with Ctrl+C.
`pnpm --filter @retro/frontend preview` serves the production build with the same
host/strict-port settings, after `pnpm build` and with the dev server stopped.
The isolated E2E runner always sets `HOST=localhost`.

Choose the backend path before setup:

- **Fresh Nhost stack:** `nhost up` with this checkout already applies the app
  migrations/metadata. Skip `local:apply`; proceed to `pnpm dev` and onboarding.
  If run anyway, its “CLI-applied local migration lacks a verified checksum”
  refusal is expected and harmless: nothing needs adoption or reconciliation
  solely because this helper has never run.
- **Existing pre-migration stack:** run `pnpm local:apply` before `pnpm dev` to
  add the app without resetting developer data. Do not restart it with `nhost up`
  first.

`pnpm local:apply` prepares that existing developer backend, not the test
stack. It preserves data, takes restricted backups, records migration checksums,
merges only retro metadata and refreshes Constellation. It never resets volumes
or runs down SQL. It requires this repository's running `backend-*` project on
HTTPS 443/Postgres 5432; no database URL or admin secret needs to be pasted.

Create/verify your email account in the app. Retrieve the OTP from
<https://local.mailhog.local.nhost.run> (local mail capture, no external SMTP).
Then a trusted local operator can bootstrap facilitation from repo root:

```sh
pnpm facilitator grant you@example.com --developer
# Refresh/sign in again, then use “Facilitator workspace”.
# To revoke: pnpm facilitator revoke you@example.com --developer
```

OTP requests can create new accounts, but verification is required for access.
The helper never creates users or grants an ineligible account. See [developer setup details](docs/operations.md#developer-local-setup-no-reset)
for backups, safe retries and limitations. No persistent frontend server is
started by setup.

### Public configuration

`frontend/.env.example` documents `VITE_NHOST_SUBDOMAIN` and `VITE_NHOST_REGION`.
The Nhost SDK derives service URLs from those values; both default to `local` for
the existing HTTPS developer stack. Set your project's subdomain and region in
`frontend/.env.local` or the environment for a different local/cloud project.
Optional `VITE_NHOST_AUTH_URL` and `VITE_NHOST_GRAPHQL_URL` overrides take precedence
for custom endpoints; the isolated E2E runner supplies them automatically to select
its registered stack and GraphQL engine. Direct GraphQL requests use the SDK's
resolved endpoint too.
**All `VITE_*` values are public browser inputs. Never add admin secrets, JWT signing
keys, database passwords or SMTP credentials.** Local environment files are ignored.

The existing developer backend is not disposable. Installing/serving does not
reset Docker, database volumes, migrations or metadata. Explicit signup/sign-in
naturally writes Auth accounts/sessions on the configured backend. Integration commands
below provision a **separate disposable project**; never reset `backend-*`.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @retro/frontend build
nix flake check
```

`pnpm format` applies Biome formatting, import organization and safe fixes. Tests
use Vitest, jsdom and Testing Library to exercise routes, OTP forms, guarded access,
auth generations, session/question management, draft preservation and late-response
rejection. Both GraphQL engines are tested with real JWTs for live eligibility,
revocation, private-card projections/ownership, management permissions and immutable
closure. Desktop/mobile browser journeys prove two-person isolation, multiple cards,
confirmed deletion and stale-draft retention after ending. Board journeys cover
real mouse/touch/keyboard moves, failed stale destinations, post-end grouping,
long-text/mobile layout and axe checks without serious/critical findings. Controlled Postgres
connections prove both closure lock orders and rollback behavior. Backend unit tests exercise target
guards, operator loopback connections, occupied ports, budgets and metadata loading.
CI also provisions the isolated stack and executes the real-JWT, scratch-migration
and Playwright gates. Frontend and acceptance jobs run through `nix develop` using
the same pinned Node, pnpm, Biome, Nhost CLI and Chromium as local development.
There is no separate CI tool installer or browser download; the flake is the
shared toolchain source of truth.

### Disposable backend and browser acceptance

A running local Docker daemon is required. From the repo root, inside `nix develop`:

```sh
pnpm test:target provision
pnpm test:target health
pnpm test:migrations
pnpm test:backend                       # real JWTs on both GraphQL engines
pnpm test:e2e                           # canonical Constellation
pnpm test:e2e --engine hasura            # full second-engine browser acceptance
# Only when finished with this disposable stack:
pnpm test:target destroy
```

The runner reserves HTTP **18080**, Postgres **55432**, and browser Vite **5173**.
It never registers the developer project, reuses developer secrets, or resets
unmarked targets. Outside Nix, install the pinned CLI and Chromium prerequisites
as described in [docs/operations.md](docs/operations.md). Missing services/browsers
and occupied ports are failures, not skipped tests.

The workspaces are `frontend` and `backend/tests`. Root recursive scripts run all
introduced unit suites; the explicit commands above run integration acceptance. `backend/functions` is an unused, independent
scaffold with a placeholder test; it is deliberately not an application workspace
and is not represented as a passing suite.

### Biome on NixOS

Npm’s native Biome executable uses a generic Linux dynamic-loader path that NixOS
cannot run without compatibility tooling. The default `nix develop` shell exports
`BIOME_BINARY` pointing to its Nix-built Biome; the npm wrapper honors this setting.
No `node_modules` patching or `nix-ld` setup is needed. Run `nix develop -c pnpm lint`
from outside the shell. Other platforms use the pinned npm binary normally.

The npm pin and `biome.json` schema match `nhost.biome` (currently **2.5.11**).
`nix flake check` enforces this version contract; when updating the flake input,
update the npm pin, schema and lockfile together.

When editing line-broken JSX headings, keep a space before `<br />`: the line break
alone does not separate words in the computed accessible name checked by tests.

## Decisions

See [docs/decisions.md](docs/decisions.md) for implementation choices. Production
hosting/onboarding is deferred: it requires operator-supplied frontend URLs and
custom SMTP configuration/capacity review. No production values are assumed here.
[Operations](docs/operations.md) covers static-host fallback, backend-first rollout,
backups, safe rollback and retained-account constraints; [local acceptance
evidence](docs/acceptance.md) records the fresh disposable replay. CI runs isolated
Hasura/Constellation acceptance lanes, never the developer stack.
