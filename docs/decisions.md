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

## Phase 6 — Independent, private grouping API

- **Grouping never writes answer rows.** Topics and one optional assignment per
  answer are separate tables; composite foreign keys bind both ends to the same
  question. Only `topic_id` changes on a move. Topic identity/parent/creation time
  and assignment answer/question are immutable even in direct SQL. There is no
  closure predicate on grouping: closed-session content remains frozen while
  topic CRUD, group/move/ungroup and topic-deletion cascades remain available.
  Deleting a topic removes assignments only; deleting an active answer removes
  its assignment, not its topic. Empty active questions may cascade their topics.
- **Global facilitation, no participant schema or directory.** Every grouping and
  author permission checks live eligibility and trusted membership. Participants
  (including a facilitator using `user`) have no grouping/author types,
  relationships, filters or aggregates. A read-only view projects only ID,
  display name and email for accounts with retained answers, including former
  participants; no general Auth directory is exposed. Explicit relationships
  support a per-question board without extending participant projections.
- **Explicit writes and server-authoritative conflicts.** The API supports
  assignment insert, topic-only update and delete. A duplicate insert fails;
  supported crafted upserts can only change `topicId` within the existing
  answer's question. Concurrent moves serialize on the assignment row (last
  successful write wins). If a destination was deleted, insert/move fails by
  foreign key; a missing assignment/topic update/delete returns zero affected
  rows. Deleting a destination after a successful move cascades its assignment,
  returning the card to Ungrouped. Callers must refetch after failure or zero
  rows rather than parse engine errors, retry stale intent or assume success.
  Both engines' real-JWT tests cover these contracts, including controlled
  blocking/rollback races and unchanged answer text, author and timestamps.
  The board UI remains Phase 7; no unfinished controls are advertised now.
- **Acceptance repair outside the API slice.** The pre-existing OTP journey started
  its five-second second-tab UI assertion at navigation completion, although
  readiness waits for the cross-tab session lock and a separate token rotation
  (whose request bound is fifteen seconds). It now waits for successful, completed
  token responses before asserting the same signed-in UI. A
  promise-gated real rotation also checks the pending loading shell, so this
  asynchronous boundary is exercised deterministically, without sleeps, polling,
  retries or relaxed assertions/timeouts. The context-wide fake clock is installed
  before application timers and its resend-only wall-clock advance is realigned
  before verification/restoration. No runtime Auth behavior changed. The historical
  intermittent failure did not reproduce in six diagnostic mobile runs; these
  changes remove the identified unsynchronized readiness/timer hazards rather
  than claiming a measured server or Web-Lock delay from that prior failure.

## Phase 7 — Accessible facilitator reflection board

- **A separate question route with an explicit role.** Facilitators enter the
  board from each question, including ended sessions. The authenticated workspace
  rejects participant deep links before mounting any board query. A small typed
  facilitator-only projection fetches the question, ordered topics and cards with
  minimal author identity; both question and session IDs constrain the read.
  The exact SPA document is also executed with real JWTs on both engines. Shared
  dependency-light query modules use `.js` import specifiers so both Vite and the
  backend tests' NodeNext TypeScript resolver can consume them.
- **Server-authoritative grouping, not optimistic rearrangement.** A move chooses
  explicit assignment insert/update/delete from the displayed snapshot. There is
  one in-flight grouping write; zero affected rows and failures trigger a refetch
  and a sanitized grouping-specific message, never a stale automatic retry or a
  misleading “session ended” error. The displayed snapshot stays fixed during
  dragging or a pending write while polling may refresh the underlying cache;
  releasing it exposes the latest authoritative data. Topic deletion is confirmed
  and moves assignments to Ungrouped without touching answer content. No backend
  permissions, SQL invariants or production configuration change in this slice.
- **Equivalent paths, calm presentation.** Grip-only mouse/touch sensors let the
  rest of a post-it remain scrollable/selectable; touch activation requires a short
  hold. Keyboard arrows step through columns in DOM order, even when mobile stacks
  them vertically. Keyboard collision targets are explicit: column centers can
  misclassify a tall card beside an empty column. The browser journey moves a
  4,000-code-point card into an empty theme. A labelled native Move-to menu is
  always available. Moves restore
  focus by stable card/control ID after the column remount and announce the result;
  cancellation, rename and confirmed deletion also have explicit focus targets.
  Cards keep stable muted colors, wrap plain text and show author names/emails only
  here. The palette is decorative, helping visually track a card across moves; it
  does not encode author, topic, sentiment or status. Labels and columns carry all
  meaning without relying on color. Reduced-motion styling and a nonanimated drag
  overlay avoid unnecessary motion. Ended boards expose grouping controls, never
  content editors.
- **A refetch failure is not an empty workspace.** The board route keeps its cached
  session and mounted board on transient session-read failures, with an inline
  alert. Replacing the whole route with an error would destroy the drag context,
  focus and topic drafts even when the independent board query still succeeds.
  The router/AuthProvider regression checks retained DOM identity, focused rename
  input and both topic drafts through session-read failure and recovery. Successful
  empty reads or auth-generation cleanup still remove unavailable private data.
- **Browser gesture tests must follow real geometry and event readiness.** DnD
  auto-scroll can change viewport coordinates while waiting for a real poll; measure
  destination geometry at movement time, not at pickup. The pinned KeyboardSensor
  attaches document listeners on the next task; synchronize a paint after pickup
  before an immediate synthetic Escape. Desktop mouse, mobile CDP touch, keyboard,
  native Move-to, stale-target rejection and axe scans exercise actual controls,
  rather than replacing the drag library with test-only callbacks.

## Phase 8 — Foreground synchronization and privacy boundaries

- **Browser activity is observable state.** Mounted authorized reads poll every
  two seconds only while visible and online. Visibility/connectivity events both
  disable future reads and cancel current reads; becoming active enables an
  immediate stale refetch. Merely returning `false` from an interval callback
  neither cancels a pending fetch nor reliably restarts the interval on visibility
  changes. Focus/reconnect refresh and mutation invalidation still use the same
  TanStack Query cache. A quiet workspace status explains session, offline and
  background pauses; it never advertises live updates while private data is paused.
- **Cancellation plus acceptance checks.** Each request has a route/hook lifetime
  signal, and Auth owns a separate private-data signal. Identity, membership or
  query-eligibility changes abort that signal and cancel/remove old queries.
  Late responses are checked again against the auth generation and aborted signal,
  even if a transport ignores cancellation. Route-level role changes remove the
  other role's private queries. Auth also rejects pending refreshes when a
  same-tab SDK account change arrives, not only on cross-tab storage events.
  A dedicated expiry timer pauses data exactly at JWT expiry even if a refresh is
  still pending. Hidden/offline tabs do not repeatedly refresh credentials; expiry
  still clears their private cache, and foreground reconnection retries.
- **Preserve intent without retaining expired server data.** A workspace-scoped
  in-memory map retains only user-entered text across transient JWT-expiry remounts.
  Stable entity IDs identify edited cards/questions/topics, not changing display
  numbers/names. Account, membership, application-role or route changes replace
  the map; success/Cancel or toggling a rename closed removes that form's draft.
  Nothing is written to browser
  storage. Same-account recovery restores editors while server responses are
  fetched anew. Signout or authoritative session rejection discards drafts too:
  shared-browser privacy takes precedence over cross-sign-in draft recovery.
- **Permission results outrank gesture stability.** A successful empty board read
  removes the private board even during a drag; holding geometry must not retain
  data after access loss. Transient read failures still preserve mounted drafts
  with sanitized feedback. Real independent browser contexts check card/topic/move
  and closure propagation with five-second bounds, offline catch-up, an authentic
  delayed response across signout/account replacement, and live membership/account
  revocation. Controlled component clocks cover hidden/offline teardown and JWT
  expiry without weakening Auth policy or spending extra OTP requests.
- **Malformed links are unavailable resources, not connection failures.** Check
  canonical UUID shape before mounting session or board queries and reuse their
  unavailable states. Do not constrain UUID versions or variants: the database
  accepts more than the currently generated UUID version. Neither GraphQL engine
  accepts malformed UUID variables, so issuing these reads would otherwise produce
  misleading connection/access alerts and retry/poll indefinitely.
- **Keep intercepted JWT traffic in Chromium.** Playwright `route.fetch()` uses
  Node DNS, not Chromium's `--host-resolver-rules`, and its network errors include
  request headers. For delayed-response tests, capture successful browser response
  JSON in memory and replay it through `route.fulfill({json})`; do not route real
  JWTs through a Node client that may print Authorization headers on failure.
- **Isolate public module transport, not application networking.** A blank
  facilitator first load reproduced before React executed: `#root` was empty and
  Chromium reported `net::ERR_NETWORK_CHANGED` for Vite's CSS, JSX runtime and
  application module imports. Both pinned headless-shell and full Chromium
  reproduced it; changing Auth/router code or browser channels would not fix
  aborted entry modules. The browser fixture therefore fetches only localhost
  script/style/font/image GETs from the real Vite server through Playwright's
  runner transport, with empty Authorization/Cookie headers, no redirects and no
  retries. Missing assets/server still fail. Documents, WebSockets and all
  Auth/GraphQL traffic retain real Chromium networking; no app responses are
  mocked, network notifications suppressed or acceptance bounds relaxed.
  Documents must not be fulfilled by the runner: Chromium otherwise classifies
  the origin as public and blocks loopback API access under local-network/CORS
  enforcement. Keep a 24-fresh-context boot regression per project and sanitized
  failure paths; never log storage, headers or private response bodies. Optional
  Vite/HMR imports can outlive the first app render and be retired by navigation;
  ignore only browser-confirmed `ERR_ABORTED` or closed-page failures in that
  transport, not missing assets or unexpected fetch errors.
- **The outer runner owns all finite descendants.** Suite subprocesses run in a
  dedicated process group. Before timeout/interruption signals, capture its
  descendant process groups from PID/PPID/PGID only: Playwright starts Vite and
  browsers in their own sessions, so killing the pnpm group alone still leaked
  Vite in a deliberate timeout diagnostic. Terminate owned groups and escalate
  resistant descendants after five seconds before returning and releasing the
  disposable-stack lock. Never discover or kill processes by name. Playwright has a ten-second action
  timeout and eight-minute global timeout inside the ten-minute outer cap: a
  failing step can report and clean up instead of pnpm exiting while Playwright
  and Vite keep running. Context cleanup in test `finally` blocks is best-effort
  because timeout teardown may already have closed the browser; it must not mask
  the original failing locator.

## Phase 9 — Replayable operational acceptance

- **Exercise both engines in the browser, not just metadata/API probes.** CI runs
  independent fresh-stack Hasura/Constellation lanes; each retains the complete
  dual-engine JWT suite, scratch rollback/reapply, and desktop/mobile journeys.
  `pnpm test:e2e` defaults to Constellation; the only alternate is the registered
  Hasura endpoint via `--engine hasura`. Shared endpoint resolution also aligns
  privacy/stale-response interceptors with the actual SPA URL. No arbitrary URL
  override, second application client or production endpoint switch was added.
- **Refuse ambiguous destructive commands.** Target, backend and migration
  commands now reject unused target/path arguments before touching a stack.
  Previously an extra argument could be ignored while operating on the registered
  target, which is safe from developer resets but misleading to the operator.
  Wrapper-level tests prove rejected registration prevents SQL, metadata, Auth,
  browser startup and filesystem deletion. Existing real guard tests retain the
  independent Docker/database-identity checks; mocks do not replace those gates.
- **Replay only disposable data; retain production content.** Final acceptance
  exercised guarded stop/resume/destroy/fresh-provision, a different database
  identity, both-engine permissions/races and all browser journeys. The existing
  developer container identities stayed unchanged through that disposable replay.
  The separate additive developer setup later refreshed only Constellation.
  Operational documentation
  distinguishes compatible frontend/metadata rollback from destructive scratch
  `down.sql`, and explicitly defers production URL/SMTP choices and account
  retention/deletion to reviewed operator procedures. No deployment, role grant
  to developer users, developer reset, or production configuration edit occurred.
- **Make Nix checks observable.** CI builds the named format/tool-version checks
  as well as running `nix flake check`, because an earlier local invocation
  reported zero checks. One invocation ran all three; explicit named
  aarch64-linux derivations also built successfully. CI's x86_64-linux lane
  remains configured, not locally executed.
- **Developer setup is additive, not a disposable-target exception.** The final
  handoff additionally prepares the existing HTTPS developer backend through
  `pnpm local:apply`: fixed Docker/config/DB identity checks, restricted streamed
  backups, advisory locking, transactional up/checksum history, app-only metadata
  merge with resource-version protection and only Constellation recreation.
  Existing Auth/storage data fingerprints and non-retro metadata were preserved.
  No down/reset path or developer-target registration was added. Unknown history
  fails for explicit reconciliation instead of guessed adoption. The trusted
  `--developer` facilitator shortcut resolves an existing verified email without
  exposing credentials or creating an operator account. Standard CLI versions are
  mirrored only after checksum-verified SQL commits using `--skip-execution`,
  with status verification: pinned `nhost up` otherwise automatically replays
  unrecorded migrations. Conversely, `nhost up` can apply a new migration before
  this helper sees it. Setup therefore reads/parses CLI status through the
  validated console before SQL/backup creation and validates the entire checksum
  history before executing any migration. A CLI-applied version without a
  verified ledger checksum fails closed: no transaction, backfill replay, ledger
  insert or automatic adoption. It needs explicit, backed-up operator
  reconciliation, not a reset. Verified ledger entries still skip SQL when CLI
  mirroring is pending. Regression tests cover both history directions and
  missing/ambiguous/dirty CLI status before any DB connection or backup.
  The parent owns starting the persistent frontend after review.
- **Use native tools for hosted acceptance; keep Nix as a separate gate.** A cold
  `nix develop` could source-build the development toolchain before any acceptance
  test ran. Hosted lanes now use Node/pnpm pins, checksum-pinned official CLI
  archives matching the locked flake and npm-matched Playwright browsers.
  The arm64 installer and amd64 archive digest were validated locally; no hosted
  execution or deployment was claimed. Local Nix workflows remain unchanged.
- **Connectivity is one optimistic event model.** Auth, activity notices, reads
  and mutation guards now share TanStack `onlineManager`, initially online and
  driven by browser events rather than `navigator.onLine`. A false LAN hint must
  not permanently gate reachable loopback services. Real offline events still
  stop/cancel reads and suppress queued writes; online events resume them even
  when the hint remains false. Auth retry/expiry/cancellation privacy contracts
  are unchanged. Regression tests cover cold restoration, refresh retry,
  foreground reads and fresh card/board writes under that false hint.
- **Final handoff scope expansion was explicit.** Parent-requested developer
  readiness, native hosted tooling and carried-forward connectivity hardening
  extend the initial Phase 9 runner/docs file list. They add no app service,
  deployment, production setting or persistent process. All suites were rerun;
  each engine's final browser run took 3.9 minutes, below the unchanged
  eight-minute global and ten-minute outer caps.
- **Own CLI descendants, not just the direct PID.** Review reproduced a hung
  `execFileSync` startup beyond its timeout because inherited pipes stayed open.
  Nhost/Compose now use bounded async process groups, TERM/KILL cleanup and
  explicit pipe closure; exit is handled before pipe-close. Startup always
  repairs/rebinds its reserved runtime, even on failure, and first provisioning
  also owns the runner lock. Fake slow/pipe-holding descendants cover timeout,
  exit and both interrupt signals. No background launcher or broad process kill
  was introduced.
- **Recover proven partial state without relaxing normal guards.** Resume first
  checks registration/labels/ports and the actual existing data volume, rewrites
  only the generated loopback bindings idempotently, starts the proven
  Postgres/Traefik services and requires the unchanged strict identity/network
  guards before app work. A running DB proves identity before repair; a stopped
  one immediately after startup. The same bounded repair runs after failed
  `nhost up`; automatic CLI down-on-error is omitted to retain ownership
  evidence. Mismatched identity, labels, ports or volumes still fail closed.
- **Fresh CLI-created stacks need no additive helper.** `nhost up` with this
  checkout already applies app SQL/metadata. Its CLI-only history must not be
  adopted into the helper ledger; an optional `local:apply` refusal there is
  expected and harmless. Only the pre-migration developer stack needs the
  additive path. Unexpected mixed histories still require backed-up operator
  reconciliation, never resetting or replaying SQL.
- **Distinguish public-asset teardown from transport failure.** A final browser
  gate exposed an intermittent pending Vite asset error. A finite browser
  diagnostic demonstrated that context disposal rejects `route.fetch` with
  `Request context disposed.` while request failure is unset. The public-only
  asset bridge recognizes that explicit lifecycle cancellation independently
  of page-close events; genuine transport failures still fail, credentials
  stay stripped and no retries were added. Seven unit cases exercise the
  bridge; both complete browser engine suites passed afterward.
