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

## Phase 3 — Verified OTP and trusted facilitation

- **Separate signup and sign-in, no password UI.** Exact company emails are
  normalized to trimmed lowercase. Existing Auth policy remains byte-for-byte
  unchanged; real Mailhog OTPs exercise verification, invalid/expired/used codes,
  resend and restoration. Unknown-account sign-in intentionally returns OK without
  a session or account (anti-enumeration), so users explicitly choose Create
  account. The signed-in shell honestly shows account readiness, not pretend data.
- **Explicit lifecycle coordination on SDK primitives.** Nhost JS 4.9.0 owns Auth
  requests, session decoding/storage and session notifications. Its default
  middleware accepts responses without an application auth epoch, so this SPA uses
  explicit refresh coordination instead: the SDK's cross-tab Web Lock name,
  refresh on restoration/focus/reconnect/expiry, bounded requests and abort/epoch
  acceptance. Epoch checks reject delayed same-tab verify/refresh responses. In
  Web-Lock-capable browsers, signout also takes the exclusive SDK lock: refresh
  persists its rotation before releasing the lock, and signout clears/revokes the
  latest token under that same lock. Local access clears immediately; rotation
  events are suppressed while signout waits, so an in-flight cross-tab refresh
  cannot restore it. Without Web Locks, epoch checks still protect same-tab work.
  Storage events adopt rotations without reflexively refreshing again (avoiding a
  cross-tab refresh ping-pong). Only 401 or an ineligible session deletes stored
  credentials, matching the SDK: transient failures do not invalidate a refresh
  token even when its access JWT expires. Keep the account shell with a notice;
  at JWT expiry cancel/clear private queries once, advance their generation and
  set `canQuery=false` until recovery. Unexpired JWTs retain their queries. Retry
  backoff doubles from one second to a ten-second cap and resets on success;
  focus/reconnect/visibility still retries immediately. TanStack Query is
  memory-only; identity/role changes also cancel/clear it, with generation/user/role
  key helpers ready for the next data slice. Client checks are UX, never data
  authorization.
- **Provisioning is trusted SQL, not metadata or a frontend role toggle.** The
  reversible migration registers the role but gives no memberships. Down refuses
  live grants/defaults rather than silently deleting privileges. The local-only
  operator command locks the account, verifies eligibility and ordinary user
  membership, keeps default `user`, and changes only the requested membership.
  Tests reuse guarded disposable connections. An explicit loopback-only SQL URL
  additionally supports operator use on the existing developer backend without
  exposing credentials or adding a server; test/reset tools never use that URL.
  Both engines still expose no application access, even to internal `me` or
  trusted facilitators. Live data-permission revocation is deferred to Phase 4.
- **Reuse isolation and measure edge behavior.** Browser and policy requests spend
  the existing per-group budgets; browser mail/codes stay in process memory and
  no traces/storageState are written. The pinned Mailhog HTML contains six-digit
  CSS colors; code extraction therefore anchors to element text. Backend SQL
  expires only the disposable fixture's OTP to test expiry without waiting or
  weakening Auth. Browser clock advancement tests only the resend cooldown.

## Phase 4 — Shared conversations and immutable closure

- **Live data authorization, not refreshed claims alone.** The tracked but
  unselectable `retro_eligible_users` view checks verification, disabled/anonymous
  state, exact case-insensitive company domain, default `user` and live `user`
  membership. Every app permission uses it; facilitator permissions also require
  its trusted membership flag. `me` and other internal roles gain no app access.
  Both engines deny old facilitator JWTs immediately after SQL revocation. Real
  refreshed JWTs after an external email change also receive no app rows.
- **One locking boundary per conversation.** Every question write locks the parent
  session `FOR SHARE` while reading its current `ended` value. Session updates
  conflict with that lock; an end that wins first makes blocked content writes
  fail. The database also forbids identity/parent/timestamp changes, reopening and
  every update/delete of an ended session. Ending and renaming are separate
  operations. Restrictive foreign keys prevent nonempty session deletion without
  a cascade or a privileged content-maintenance bypass.
- **Shared reads, separate management.** Session/question projections are identical
  for eligible participants and facilitators, so their small typed read documents
  are shared, with distinct role-scoped cache keys. Session mutation documents
  are separate and facilitator routes send the explicit `facilitator` role.
  Participant screens do not expose answer/board placeholders. Polling is
  introduced now for the usable session slice: mounted visible routes refresh
  every two seconds, with abort signals, generation acceptance and invalidation.
  The broader multi-account/offline/board acceptance still belongs to Phase 8.
- **Plain text without Unicode surprises.** SQL trims the explicit ECMAScript
  whitespace set; both layers count Unicode code points, including emoji and
  combining characters. Session names cap at 120, questions at 500. Editors keep
  dirty text through refetch, failed writes and closure; closure disables retained
  drafts rather than discarding them. Mutations fail immediately offline rather
  than queueing an intent for later replay. Native confirmations default to Cancel.
- **Acceptance remains disposable.** Browser runs now apply current migrations and
  synchronize both engines before starting Vite, so they do not depend on a prior
  backend test run. Ended synthetic sessions deliberately remain in the test
  database until guarded target destruction; cleanup does not bypass the freeze.
  Browser fixtures seed SDK storage once per context (not per tab): reseeding an
  old refresh token in a new tab invalidates the rotated session. Native dialogs
  must leave the modal top layer with `close()` before restoring invoker focus;
  unmounting an open dialog alone did not restore focus in Chromium.

## Phase 5 — Private, multiple reflection cards

- **One thought per card, no per-person uniqueness.** A separate answers table
  permits multiple cards per question, with indexed author/parent filters and
  restrictive question/account foreign keys. Shared whitespace trimming and
  Unicode code-point limits extend to 4,000-character cards. Text-only updates
  preserve author/identity/parents/creation time; SQL owns the update timestamp.
- **Private participation is a real API role, not a UI filter.** Participant
  projections omit author IDs; every answer select/insert/update/delete checks
  live eligibility and ownership, with author set from the JWT. Updates also have
  explicit post-update checks. Relationships to shared questions filter answer
  collections again, and neither role gets aggregates or an Auth directory.
  Trusted facilitators have read-all including author IDs, but no answer-content
  mutations; they use the ordinary participant route to contribute. Author
  names/emails, topics and board UI remain deferred to their planned slices.
- **The same closure lock covers every content write.** Answer triggers join the
  immutable question parent and read the session’s current ended state while
  acquiring `FOR SHARE OF s`. Direct SQL, real JWT requests, both lock orders and
  write/close rollbacks prove insert/edit/delete serialization. Question deletion
  requires no answers at both permission and foreign-key boundaries. Retained
  answers deliberately prevent account deletion; disposable test cleanup retires
  such accounts and revokes sessions/membership instead of erasing frozen content.
- **Calm editors retain intent, not optimistic content.** Role/generation-scoped,
  abortable queries poll mounted participant cards using the existing lifecycle.
  Mutations remain server-authoritative and invalidate queries. Stable card IDs
  keep dirty edits through refetch; stale failed submissions and closure retain
  both edited and new drafts, disabled after ending. Wrapped post-its, explicit
  labels, native delete confirmation and focus targets support mobile/keyboard
  use. Post-confirm focus callbacks run only after `dialog.close()` because
  elements outside a native modal are inert. Cancel/Escape return to the trigger;
  confirmed card/question deletion and ending focus a persistent section heading.
  Pending text forms use read-only fields and guarded, aria-disabled submit
  buttons instead of disabling focused controls, so keyboard submissions retain
  focus without allowing duplicate writes. Closed forms remain truly disabled.
  Role-specific documents live in dependency-light modules so real-JWT tests
  execute the same queries and inspect actual role input/output schemas, without
  introducing codegen or a second client/cache layer.
