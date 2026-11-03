# Retro

A calm retrospective workspace for your team. Built with React, TypeScript,
TanStack Router and TanStack Query, backed by Nhost Auth and GraphQL.

## Current slice

Verified email OTP signup/sign-in, restoration and cross-tab signout lead to
active/ended retrospectives and their questions, visible only to explicitly enrolled
participants and trusted facilitators. Facilitators add/remove existing verified
accounts per session; new and existing sessions start with no participants (no
migration backfill). Facilitators must also enroll themselves to contribute.
Participants add multiple
reflection cards per question, private until the session ends, and edit/delete only their own active cards;
operator-provisioned facilitators create, rename, delete empty sessions, manage
questions and permanently end conversations. Backend permissions recheck live
account eligibility and trusted membership; database locks freeze closed content
even for stale/concurrent clients. Verified accounts from any email domain are admitted;
no password UI exists. Facilitators open a per-question reflection board with
author-labelled cards, named topics, mouse/touch/keyboard dragging and a Move-to
menu on every card, plus a participant response filter. Removing a participant
revokes session/question/card access without deleting their responses; retained
authors remain filterable. Each question also supports multiple facilitator-managed
follow-ups: a required action (1–500 characters), one participant owner and an optional
HTTP(S) ticket link (up to 2,048 characters). A session-level summary collects these
outcomes with links back to their question boards. New assignments require a current,
eligible participant; removing an owner preserves existing actions and their identity.
Questions with follow-ups cannot be deleted until the actions are explicitly removed.
Participant management, topic management, grouping and follow-up CRUD stay available
after ending; facilitators never edit another person’s answer content. Once ended,
all currently enrolled, eligible participants can read everyone’s cards, authors,
themes, grouping and follow-ups (including retained owners) in a read-only board,
with a session-level follow-up summary. Active-session privacy is unchanged;
participants gain no management permissions or general account directory. Ticket links open the external
tracker; no ticket creation or status synchronization is performed.
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

### Local demo seed

`backend/nhost/seeds/default/20261106000000_demo_retros.sql` creates:

- `facilitator@acme.local` with trusted facilitator membership.
- Eight fictional participants: `avery`, `jordan`, `samira`, `diego`, `mei`, `noah`,
  `imani` and `luca`, all at `@acme.local`.
- Three retrospectives (two active, one ended), with all nine demo accounts enrolled
  only when each demo session is first created; replay never restores removed
  memberships or missing cards for authors who are no longer enrolled.
- Nine questions, 72 responses,
  19 topics and 54 assignments; 18 cards remain ungrouped.

Nhost applies seeds on the first local startup. For an existing stack, add
`--apply-seeds` to your usual `nhost up` command, retaining its existing
root/project/subdomain/port flags. This applies pending migrations first; do not
reset volumes. Use this seed only for local development, never production.

Sign in with a seeded email and retrieve its OTP from your local Mailhog. No
shared password is configured. The facilitator can switch to **Facilitator
workspace**; every account retains the ordinary `user` default, and signup still
cannot request facilitator privileges.

The seed is atomic and repeatable. Existing cards, names, account state and group
moves are not overwritten, and revoked facilitator membership is not restored.
Missing cards and their assignments are restored only if the author is still
enrolled in that session; otherwise they are skipped without restoring membership.
An account-ID/email collision aborts the seed rather than granting a role to the
wrong person. Tests run it inside rolled-back disposable transactions; they do
not populate or reset the developer database.

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

## Nhost as an OIDC provider

`/oauth2/login` is the consent page for Nhost's OAuth2 provider. Set
`auth.oauth2Provider.loginURL` to this page's absolute URL on the same frontend
that uses your Nhost project (locally, `http://localhost:5173/oauth2/login`).
Register OAuth2 clients and enable the provider in Nhost before using the flow.
For production, configure the deployed URL in the project's settings as well.

Start sign-in from the third-party application, not this page directly. Nhost
redirects here with `request_id`; the page retrieves the validated client ID,
callback and scopes from Auth. Existing sessions are reused; otherwise the normal
email-code form signs in without losing the request. Signing in never grants
access automatically: the user must choose **Allow access** before the page posts
consent with their Nhost access token and follows Auth's returned callback.
Only HTTP(S) callbacks are supported. The frontend never exchanges codes or
handles a client secret.

With Auth 0.52.0, every approval grants renewable background access, even without
`offline_access`; each refresh renews the refresh-token lifetime set by
`auth.oauth2Provider.refreshToken.expiresIn` (currently 2,592,000 seconds / 30 days).
This app has no user-facing grant revocation controls: refresh tokens expire if the
application stops renewing them, or an operator can revoke them.

**Cancel** grants nothing and stays on this site. The current Nhost login API has
no denial endpoint or state-bearing rejection response, so the page does not
fabricate a callback; close it and return to the application. Expired, completed
or invalid requests must be restarted from the third-party application.

## Deploy frontend to Cloudflare Workers

The default `nix develop` shell includes Wrangler. Run from the repository root:

```sh
nix develop
pnpm install --frozen-lockfile
wrangler login  # Or securely export CLOUDFLARE_API_TOKEN for automation.
export CLOUDFLARE_ACCOUNT_ID='<production Cloudflare account ID>'
export VITE_NHOST_SUBDOMAIN='<cloud Nhost project subdomain>'
export VITE_NHOST_REGION='<cloud Nhost project region>'
make deploy-frontend WRANGLER_DEPLOY_ARGS=--dry-run  # Build/package only; no upload.
make deploy-frontend
```

This builds the SPA and deploys Worker `retros` with its static assets to the
existing **`nhost-app` Workers for Platforms dispatch namespace**. The infra-managed
wildcard DNS and dispatcher already send `https://retros.nhost.app` to that Worker;
this app does not create DNS, routes, custom domains, or another dispatcher.
The Cloudflare identity must be able to deploy scripts/assets to that namespace
(account **Workers Scripts: Edit** permission); the namespace must already exist.

Override the hostname through the environment or Make, for example:

```sh
FRONTEND_DOMAIN=retro-preview.nhost.app make deploy-frontend
```

Only a single lowercase `<name>.nhost.app` label is accepted, matching the existing
dispatcher's routing. The Worker name is derived from that label, so the example
publishes a separate `retro-preview` Worker. `CLOUDFLARE_DISPATCH_NAMESPACE` defaults
to `nhost-app` and can be overridden for equivalent infrastructure elsewhere.
Domains outside `nhost.app` need separate DNS/TLS and an infra `CUSTOM_DOMAINS` KV
mapping to the Worker name; this target deliberately does not provision them.

Export the public backend variables explicitly for deployment (the guard does not
read Vite `.env*` files). Alternatively export **both** `VITE_NHOST_AUTH_URL` and
`VITE_NHOST_GRAPHQL_URL` as HTTPS custom endpoints. Existing Vite overrides still
take precedence: review them before building. All these values are baked into the
browser bundle, **not** Worker secrets. Cloudflare credentials must never use a
`VITE_` prefix. Deployment refuses implicit/local project defaults; normal local
builds and preview remain unchanged.

`frontend/wrangler.toml` serves SPA navigations (including direct deep-link reloads)
through `index.html`. Unmatched non-navigation requests, such as missing JS/CSS,
return 404 through the minimal Worker fallback. Fingerprinted `/assets/*` files
cache immutably; HTML uses Cloudflare's default revalidation policy. Configure the
production Nhost client URL/redirect allowlist and exact Auth/GraphQL CORS origins
for `https://retros.nhost.app` (or your override) before onboarding.

This target publishes only the frontend: it does not migrate/configure a production
backend, seed accounts, grant facilitators, or provision SMTP. Follow the
[production checklist](docs/operations.md#production-checklist-frontend-deployment-available)
for backend-first rollout and smoke checks. Do not deploy the local backend config
or demo seed to production.

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

In follow-up component tests, await the rendered picker change with `findByRole`
or `waitFor` after invalidating queries. The refetch promise can resolve before
React renders the updated participant options.

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

See [docs/decisions.md](docs/decisions.md) for implementation choices. Frontend
hosting is configured above; actual production rollout/onboarding still requires
an approved backend and custom SMTP configuration/capacity review.
[Operations](docs/operations.md) covers static-host fallback, backend-first rollout,
backups, safe rollback and retained-account constraints; [local acceptance
evidence](docs/acceptance.md) records the fresh disposable replay. CI runs isolated
Hasura/Constellation acceptance lanes, never the developer stack.
