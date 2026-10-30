# Retro

A calm retrospective workspace for the Nhost team. Built with React, TypeScript,
TanStack Router and TanStack Query, with Nhost as the planned backend.

## Current slice

The welcome screen is implemented, including responsive dark styling, reflection
prompts, keyboard navigation and a not-found route. It is a **welcome preview**:
sign-in, sessions, private answers and facilitator tools are not available yet.
The prompts are editorial content, not real participant answers. No backend
connection, credentials or running Nhost stack is needed to view it. Guarded
backend and desktop/mobile browser acceptance infrastructure is now available;
it does not add sign-in or application-data permissions.

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

`frontend/.env.example` documents the future Auth and explicit canonical GraphQL
(Constellation) public URLs. Copy it to `frontend/.env.local` when the auth slice
needs configuration; the current welcome preview does not consume those values.
**All `VITE_*` values are public browser inputs. Never add admin secrets, JWT signing
keys, database passwords or SMTP credentials.** Local environment files are ignored.

The existing developer backend is not disposable. These commands do not touch
Docker, Auth data, database volumes, migrations or metadata. Integration commands
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
use Vitest, jsdom and Testing Library to exercise real routes, the welcome screen,
in-page navigation, keyboard skip-link order and not-found recovery. Backend
unit tests exercise target guards, occupied ports, budgets and metadata loading.
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
