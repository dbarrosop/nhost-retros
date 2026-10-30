# Implementation decisions

## Phase 1 — Welcome foundation

- **A welcome preview, not a pretend dashboard.** The only primary action navigates
  to the approach section. Reflection prompts are explicitly editorial; no fake
  session counts, inert sign-in buttons or unfinished management controls appear.
  The availability note states that team sign-in is not implemented yet.
- **Small, local-first UI.** Plain CSS tokens, system sans-serif typography and a
  local serif accent keep the screen independent of external fonts or assets.
  Sage and peach prompts introduce the post-it palette without implying live data.
  Semantic landmarks, a skip link, visible focus and reduced-motion styles form
  the accessibility baseline. Mobile collapses to one column.
- **Typed routing and server-state ownership from the start.** TanStack Router
  owns navigation and not-found recovery; TanStack Query has an in-memory provider
  but no requests or persisted cache in this slice. Nhost SDK and drag/drop
  dependencies will be added when their actual feature slices use them.
- **Reproducible narrow checks.** Exact direct dependency versions, pnpm 12.3.4,
  Node 24 LTS and a lockfile define the toolchain. Biome checks the introduced
  frontend/root tooling only, not unrelated backend scaffolding. CI includes the
  existing Nix format gate and requires no private environment variables. Browser
  and disposable-backend runners belong to Phase 2, not placeholder scripts now.
- **One Biome version on Nix and npm.** The npm pin and schema match the flake's
  `nhost.biome` version (2.5.11). The default development shell exports
  `BIOME_BINARY` so the npm wrapper uses the Nix-built executable on NixOS, where
  the generic Linux loader path fails. This replaces manual dependency patching;
  a Nix check rejects version/schema drift. This narrowly scoped functional flake
  change extends Phase 1's formatting-only Nix scope to make clean installs
  reproducible in the repository's own development environment.

## Phase 2 — Disposable acceptance infrastructure

- **A separate reserved stack, never developer opt-in.** Repository-path-hashed
  project/subdomain names, fixed HTTP 18080/Postgres 55432, separate state/volumes
  and a database identity marker coexist with the running developer stack.
  Commands reject arbitrary registrations and remote Docker/endpoints. Final
  published ports bind loopback; HTTP is confined to this disposable target.
  Nhost's initial bootstrap publishes on all interfaces, so provisioning is for
  a trusted local host, not shared/production infrastructure.
- **Use the pinned CLI, but verify independently.** Explicit absolute root,
  configuration and state paths avoid CLI lookup ambiguity. Config is copied,
  never default-generated or overwritten in the developer project. A clean Auth
  baseline is captured before app SQL; the runner then owns a disposable-only
  migration ledger and metadata application. Hasura inconsistency checks and a
  recreated Constellation guard against false CLI success/stale role schemas.
- **No fabricated permissions to make the harness green.** Both engines accept
  real eligible fixture JWTs, but Phase 2 has no app permissions. Tests check
  Hasura's empty-role stub and Constellation's explicit missing-role schema,
  plus forged-token/directory denial. Later phases must replace these empty-role
  expectations with their actual API schema contracts.
- **Preserve the measured rate-limit behavior.** Real requests prove the configured
  ten-request per-IP burst and its reset after recreating only disposable Auth.
  Each normal group has explicit eight-request email/sign-in budgets, a runner
  lock and one worker; fixtures sign in once without sending email and refresh
  tokens in memory. No production rate overlay or SMTP credentials are needed.
  After container recreation, bounded harmless route probes wait for Traefik
  registration before spending Auth budgets or checking GraphQL. Container health
  alone proved insufficient; counted requests are never retried. Guard self-tests
  inject temporary marker copies instead of putting live registration at risk.
- **Scratch-only rollback, pinned browser runtime.** Migration down/up runs only
  in minted scratch databases restored from the stack's Auth dump/roles/extensions;
  cleanup is tested after success and a deliberate failure. npm Playwright 1.61.1
  matches the ordinary nixpkgs browser driver, not the older Nhost overlay.
  Desktop and mobile Chromium smoke tests own/tear down strict-port Vite, disable
  private browser artifacts and map the custom local subdomain to loopback rather
  than depending on wildcard public DNS. CI executes these gates immediately.
