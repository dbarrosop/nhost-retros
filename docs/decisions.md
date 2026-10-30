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
