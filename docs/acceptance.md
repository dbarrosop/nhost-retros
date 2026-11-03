# Local operational acceptance

Measured **2026-10-31 UTC** against the Phase 9 working tree based on
`8771cb9fa31808d4c5d79044e21b1c195731412d`. This is local evidence, not a
production deployment or a claim that GitHub Actions has run.

## Fresh disposable replay

All commands ran from repository cwd with Node 24.22.1, pnpm 12.3.4, Nhost CLI
1.51.2 and the pinned Nix Playwright browsers (npm Playwright 1.61.1).
The developer `backend-*` stack remained on HTTPS 443/Postgres 5432. Only the
registered `retro-test-*` stack on loopback HTTP 18080/Postgres 55432 was reset.

1. `pnpm test:target health`, `stop`, `provision`, `health`, `destroy` all passed.
   Stop/resume retained the registered project; destroy removed its resources.
2. With registration absent, the stop/destroy, backend, scratch-migration,
   browser and test-target facilitator entrypoints each exited **1**, refusing
   to run. These probes launched the actual Node wrappers, not mock guards.
3. `pnpm test:target provision` and `health` passed from absent state. The new
   database identity differed from the destroyed stack's identity.
4. The gates below passed on the newly provisioned stack. The two browser engine
   suites ran sequentially on it, respecting the exclusive Auth/reset lock.
5. On the post-review replay, all **14** actual absent-registration/bad-argument
   probes exited **1** before side effects. These included extra target/path
   arguments to stop/health/destroy/provision/backend/migrations/local setup and
   an arbitrary browser engine URL, without changing registration.
   Final health passed; developer container names/IDs matched the before-reset
   snapshot exactly. Port 5173 was free after both browser suites.

The disposable stack remains registered for subsequent local review. Generated
keys, Compose files, Auth fixture credentials and JWTs are not evidence artifacts.
No developer reset, production service or cloud project was used. OTP acceptance
used only isolated local Mailhog, not external SMTP.

## Real developer-local readiness

The operator additionally requested a usable existing developer stack, not just
acceptance infrastructure. `pnpm local:apply` applied the four additive app
migrations, merged retro metadata and verified user/facilitator schemas on both
HTTPS engines. Repeated successful runs skipped the recorded SQL. Standard
Hasura CLI state also reports all four versions applied, mirrored via verified
`--skip-execution` bookkeeping so future `nhost up` cannot replay these SQL files.
It streamed
full DB/metadata backups into restricted, ignored `backend/.nhost/retro-backups/`.
Before/after Auth/storage data fingerprints matched (excluding only the new
facilitator role registration); all non-retro metadata matched. Only Constellation
was recreated; every other developer container identity remained unchanged.

The first readiness attempt exposed an extra GraphQL brace, then a Compose
relative-mount mismatch after recreation. The probe was corrected, Compose was
reconciled with explicit `--project-directory <repo>/backend`, and repeated complete
`local:apply` runs passed without resetting data or replaying SQL. The wrapper and
regression now pin that project directory and validate the actual metadata mount.

Effective Vite development configuration resolves to the prepared public HTTPS
Auth/Constellation defaults. Developer Auth targets local Mailhog; its browser GET
returned 200 (HEAD is unsupported). The trusted `--developer` facilitator shortcut
was verified to refuse an account not yet created by OTP. No operator account,
password or role grant was fabricated. Instructions are in
[developer setup](operations.md#developer-local-setup-no-reset); after review the
parent can start `pnpm dev` via its process manager. Port 5173 is free; no persistent
frontend server was left running.

## Developer migration replay regression

Review identified that pinned `nhost up` may apply a new migration before the
custom checksum ledger knows it. Developer setup now reads clean CLI status
before any database connection or backup and validates the **entire** ledger/CLI
history before migration DDL or transactions. Unit tests prove an unrecorded
CLI-applied backfill is refused with no BEGIN, up/down SQL or ledger insert;
checksum mismatches block pending migrations in either order. Fresh setup,
full reapply and verified-but-not-yet-mirrored entries still work. Missing,
ambiguous, dirty and unknown CLI status all fail before connecting or backing up.

The revised `pnpm local:apply` passed on the prepared developer stack. Before/after
checks found identical four-entry ledger checksums **and row revisions**, identical
Auth/users/roles/storage/app data fingerprints, and four CLI-applied versions.
Only Constellation was refreshed; every other developer container ID stayed the
same. No developer data reset, migration replay or privilege change was used.
All gates below were rerun after the fix, including a fresh disposable
stop/resume/destroy/provision cycle and both browser engine suites.

## Provisioning interruption/recovery regression

A subsequent review reproduced a startup hung beyond the old synchronous timeout,
leaving a stale lock and public runtime port bindings. The corrected runner uses
bounded async process groups for Nhost/Compose and repairs proven reserved
bindings before resume and after startup (also failures). Normal strict guards
were not relaxed; startup no longer asks the CLI to tear down ownership evidence
on error.

Post-fix validation on **2026-10-31 UTC**:

- Unit regressions cover slow and inherited-pipe-holding descendants on timeout,
  early exit, SIGINT and SIGTERM, private output handling, lock release, running
  and stopped partial-state recovery, idempotence, and mismatched
  identity/label/volume/port refusal before mutation.
- Real `test:target provision` runs with a finite fake Nhost executable were
  interrupted separately by SIGINT and SIGTERM after it rewrote the registered
  runtime Compose bindings and spawned a resistant detached descendant. Both
  commands failed as expected; descendants stopped, `run.lock` disappeared and
  the unchanged strict guard passed after automatic repair. No secrets were
  captured in artifacts. The timeout itself was exercised with shortened unit
  budgets, not a five-minute production-duration wait.
- Real stop/resume passed. A second stopped-stack replay with simulated public
  bindings in its generated file was corrected **before** Compose startup;
  strict guard passed and the database identity was retained. Guarded destroy
  and all 15 absent-registration/bad-argument probes then passed, followed by
  fresh provision with a different database identity.
- Every gate below passed again on that fresh stack. All 12 developer container
  names/IDs remained unchanged, final disposable health passed and port 5173
  was free. No `local:apply` or developer data changes were needed in this pass.

Fresh `nhost up` stacks are now documented separately from pre-migration developer
stacks: the former already have app SQL/metadata and skip the additive helper.
Its CLI-only-history refusal remains fail-closed and harmless there; it does not
require adoption or reconciliation merely to use a fresh stack.

A later full rerun exposed one intermittent startup fixture failure for Vite's
`env.mjs` asset (15/16 Constellation). A finite local browser diagnostic confirmed
that APIRequestContext teardown rejects pending public fetches with the explicit
`Request context disposed.` error while `request.failure()` is unset. The bridge
now recognizes that lifecycle cancellation separately from page-close events;
ordinary network failures still reject, no retries were added, and seven unit
cases cover transport/credential/cancellation behavior. After this fixture fix,
the complete frontend suite and both full browser engine suites passed again.
The failed run is retained in the external gate logs, not claimed as a pass.

## Gate results

| Command | Measured result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Both workspaces passed |
| `pnpm test` | Frontend 79/79; backend unit 63/63 |
| `pnpm --filter @retro/frontend build` | Production bundle built |
| `pnpm test:migrations` | Pinned scratch Auth baseline/up/down/up passed, four app migrations |
| `pnpm test:backend` | 17/17 integration tests, both real-JWT GraphQL engines |
| `pnpm test:e2e` | 16/16 desktop/mobile journeys on Constellation |
| `pnpm test:e2e --engine hasura` | 16/16 desktop/mobile journeys on Hasura |
| `nix flake check` | Passed; some invocations reported zero, one executed all three |
| Named `nix build --no-link` checks | aarch64-linux `nixpkgs-fmt`, `biome-version`, `playwright-version` all passed |

The existing suites exercised OTP/Mailhog and measured rate-limit resets,
multiple private cards, trusted-role revocation, closure serialization/rollback,
post-end grouping, real pointer/touch/keyboard/Move-to controls, serious/critical
axe checks and five-second two-browser synchronization. The startup regression
also booted 24 fresh facilitator contexts per desktop/mobile project per engine.
No retries, private browser traces, screenshots, videos or storageState files were
used. Nix skips the generic browser-library probe because its browser wrappers
carry runtime libraries; the actual browsers launched and all journeys ran.
The final recovery-fix runs took **3.9 minutes on Constellation** and **3.8 minutes
on Hasura**, each with the same 16 journeys. Playwright's eight-minute global cap
and the ten-minute outer suite cap remain adequate; developer setup is a separate command, not extra browser work.
Auth/query/mutation regressions also passed with `navigator.onLine=false` while
TanStack's event-driven online state allowed working loopback requests.

Active changed-file LSP probes returned no diagnostics but could not confirm
clean status (push-only/silent-on-clean server). Both full TypeScript checks
passed; an empty LSP result is not used as proof of correctness.

CI is configured with independent fresh-stack Hasura/Constellation browser lanes,
full dual-engine backend/migration suites, frontend static/unit/build gates and
explicit named x86_64-linux Nix check builds. Frontend and acceptance commands now
run through `nix develop`, using the same locked toolchain and Nix Playwright
browsers as the local runs above. The separate native CI installer and browser
download path were removed; the earlier cold-build concern is handled with a
90-minute job budget instead of a second toolchain. YAML and command/matrix
contracts are checked locally. This workflow correction does not claim a hosted
CI run or a new browser-suite run; hosted CI and production acceptance remain
unexecuted.
Production operator inputs and safe rollback/retention requirements are listed
in [operations](operations.md#production-checklist-frontend-deployment-available).

## Unrestricted email-domain regression

Removed domain checks from Auth configuration, the live eligibility view, the
trusted facilitator helper and frontend forms/session eligibility. The new view
migration preserves all other live authorization checks and has a tested down path.

Local validation: lint, TypeScript checks, 160 unit tests and the production build
passed. A fresh registered disposable stack passed all six migration up/down/up
checks and 19 integration tests, including arbitrary-domain/implicit OTP signup,
role-escalation rejection, verified `@acme.local` OTP sessions and both GraphQL
engines. The developer database was not reset or used for these checks.

## Local demo seed regression

The native Nhost SQL seed passed three disposable integration cases: coherent
verified users/roles and boards, unchanged replay plus preservation of edits and
revoked grants, and atomic rollback on an account-ID/email collision. It creates
9 accounts, 3 retrospectives, 9 questions, 72 responses, 19 topics and 54 group
assignments. Tests roll all seed data back; the developer database was untouched.

The follow-up dual-engine browser command was blocked before browser startup by
an existing server on port 5173. That server was left running; no new Playwright
pass is claimed for these changes.

Final combined validation also passed lint, TypeScript checks, all 160 unit tests,
the production build and all 22 backend integration tests (including the three
seed cases). The six-migration scratch up/down/up check passed earlier in this
change. Browser acceptance remains blocked solely by the occupied frontend port.

## Question follow-ups validation

Local checks for facilitator-managed follow-ups passed on the registered disposable
stack; the developer backend was not migrated, reset or used for fixtures.

- Lint, both TypeScript workspaces, 153 frontend tests, 81 backend unit tests and
  the production frontend build passed.
- All eight application migrations passed scratch Auth baseline/up/down/up.
- All 28 backend integration tests passed, including the exact follow-up board and
  summary documents against both Hasura and Constellation with real JWTs. New cases
  cover participant/schema isolation, live role revocation, owner eligibility and
  removal races, retained owners, action/link constraints, immutable identity,
  restrictive question deletion and post-end CRUD.
- All 18 desktop/mobile browser journeys passed on Constellation. New follow-up
  journeys exercise creation without a ticket, owner reassignment, ticket linking,
  session summaries, post-end creation/edit/deletion, retained removed owners,
  participant non-exposure, viewport fit and axe serious/critical checks.
- The full Hasura browser suite and hosted CI were not rerun for this change.
