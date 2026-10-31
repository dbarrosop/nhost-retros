# Retro

A calm retrospective workspace for the Nhost team. Built with React, TypeScript,
TanStack Router and TanStack Query, backed by Nhost Auth and GraphQL.

## Current slice

Verified company OTP signup/sign-in, restoration and cross-tab signout lead to
shared active/ended retrospectives and their questions. Participants add multiple
private reflection cards per question and edit/delete only their own active cards;
operator-provisioned facilitators create, rename, delete empty sessions, manage
questions and permanently end conversations. Backend permissions recheck live
account eligibility and trusted membership; database locks freeze closed content
even for stale/concurrent clients. Only exact `@nhost.io` accounts are admitted;
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
pnpm dev
```

Open <http://localhost:5173>. Vite binds to localhost and **fails** if port 5173 is
occupied rather than silently selecting another port. Stop it with Ctrl+C.
`pnpm --filter @retro/frontend preview` serves the production build on the same
strict port, after `pnpm build` and with the dev server stopped.

### Public configuration

`frontend/.env.example` documents Auth and the explicit canonical GraphQL
(Constellation) public URLs. Copy it to `frontend/.env.local` for the existing
HTTPS developer stack; the example defaults are also used when unset. For the
isolated stack, the E2E runner supplies its actual public URLs automatically.
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
and Playwright gates, with matching Nix browsers.

### Disposable backend and browser acceptance

A running local Docker daemon is required. From the repo root, inside `nix develop`:

```sh
pnpm test:target provision
pnpm test:target health
pnpm test:migrations
pnpm test:backend
pnpm test:e2e
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
