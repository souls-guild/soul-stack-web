# CLAUDE.md — Soul Stack UI

Configuration file for Claude Code in the **Soul Stack UI companion repo**
(React 19 + Vite + TanStack Query + React Hook Form + Zod + lucide-react).

**Core repo** (where the backend lives): `../soul-stack` (sibling checkout in the
umbrella; the Go core — keeper/soul/soul-lint/soulctl).
**Companion plugins**: `../soul-stack-plugins`.

## Repository language: English

All source changes are in **English** — code, comments, log/error strings, tests,
docs, README, and this file. **No Cyrillic in sources.** The one exception is the
i18n product content: the Russian UI translation under `public/locales/ru/**` is
reader-facing content and stays in Russian (see the i18n section below).

## State of the UI repo

- Operator UI (vite dev on 5173, served under base `/ui/`) — **the Run Wizard is
  the primary entry point** plus ~30 pages (Operators / Services / Incarnations /
  Souls / Plugins / RBAC / Vigils / Decrees / Oracle fires / Tides /
  Errand runs / Push runs / Errands / Cadences / Synods / Notifications /
  Settings / Audit log).
- Broad unit + integration suite (112 test files / 1272 cases: vitest +
  @testing-library/react + jsdom), plus Playwright e2e smoke tests under `e2e/`.
  The vitest suite runs in CI on every push (see the CI section); the Playwright
  tier does not — it needs a live stand.
- TypeScript types are generated from `vendor/openapi/keeper.yaml` via
  `npm run gen:api` (openapi-typescript → `src/api/types.gen.ts`, then
  `scripts/gen-constraints.mjs`). That yaml is a vendored copy of the core repo's
  `docs/keeper/openapi.yaml`, synced manually on backend changes.
- Vite proxies `/v1`, `/healthz`, `/readyz`, `/openapi.yaml` to
  `VITE_KEEPER_API` (default `http://localhost:8080`) via `vite.config.ts`.

## Default persona: Soul Stack UI developer

In this session you are a frontend developer. PM logic stays in the core-repo
session; here the work is concrete UI tasks against a spec from the PM.

**Dictionary invariant:** the UI uses the Soul Stack dictionary (Keeper / Souls /
Coven / Soulprint / Tide / Surge / Vigil / Portent / Oracle / Decree / Sigil /
Toll / Errand / ErrandRun / Acolyte / Archon / AID). **No borrowed config-management jargon**
(`master`/`minion`/`grain`/`pillar`/`state.apply`) in user-visible UI strings.

**ADR mentions in the UI:** **do not** show them to the user (`ADR-NNN` in
text/hint/label). In file-level JSDoc comments they are fine for developers.

## Structure

```
src/
  api/
    keeper.ts          — API client (extended by blocks errandRuns/tides/services/...)
    client.ts          — fetch wrapper + apiSend helper
    types.gen.ts       — openapi-typescript codegen (vendor/openapi/keeper.yaml)
  components/
    layout/
      Sidebar.tsx      — primary nav: Run (top) / Registry / Oracle / Runs / Audit / Help
      HelpModal.tsx    — bottom of the sidebar: OpenAPI / MCP / docs links
      Shell.tsx        — collapsible-sidebar wrapper
      Topbar.tsx       — theme toggle + identity menu
    primitives/        — Modal, ChipsInput, Badge, ...
    icons/             — SidebarToggleIcon
    input/             — DynamicInputBuilder (form-based JSON input)
    JsonKeyFilter.tsx  — search top-level keys in large jsonb
  hooks/
    useTheme.ts        — light/dark/system + matchMedia
    useSidebar.ts      — collapsible state + localStorage
    AuthProvider.tsx   — JWT storage + login/logout
  pages/
    Login.tsx
    run/
      RunWizard.tsx              — primary entry: 4-step (workload/params/target/options)
      WizardSteps.module.css
      targetTranslator.ts        — UI DSL → ErrandRunTarget + CEL where AND-merge
    console/                     — 3rd Run mode (/run/console): live PTY shells
      MultiConsolePage.tsx       — scope step → Connect → wall + group tabs
      ScopePicker.tsx            — incarnation/coven/VM-name/soulprint + Connect
      useHostResolution.ts       — criteria → SIDs (same 3 stages as the wizard)
      consoleQuery.ts            — group query language (text <-> builder, flat)
      GroupsEditor.tsx           — operator-defined groups: query or builder
      consoleGrouping.ts         — evaluates group defs into tabs
      consoleSessionStore.ts     — sessions over one WS; output bypasses React state
      TerminalView.tsx           — the only xterm.js module (lazy-loaded chunk)
      see docs/console-ws-contract.md — the /v1/console wire contract
    operators/                   — list (Archons)
    archons/
      ArchonsList.tsx            — multi-select roles + Hide-revoked filter
      ArchonDetail.tsx           — Revoke + Roles section
      RevokeArchonModal.tsx      — JWT immediate revoke (via rbac-snapshot)
      schemas.ts                 — Zod
    services/
      ServicesList.tsx           — filter
      ServiceDetail.tsx          — tabs: Overview / Scenarios (with input_schema) / Refs (tags+branches)
      refs.ts                    — useServiceRefs hook (graceful 404 degraded)
    incarnations/
      IncarnationsList.tsx
      IncarnationDetail.tsx      — tabs: Data summary / State / Schema / Hosts / Choirs / History
      IncarnationNewForm.tsx     — Create form + scenario dropdown + DynamicInputBuilder fallback
      StateTab.tsx / SchemaTab.tsx / HostsTab.tsx / ChoirsTab.tsx
      ChipsInput.tsx, ScenarioPicker.tsx, ScenarioInputFields.tsx
      scenarioInputFields.helpers.ts — flat-map input_schema parser
      useServiceScenarios.ts      — GET /v1/services/:name/scenarios hook
      UnlockModal / UpgradeModal / DestroyModal / RunScenarioForm (orphaned, deprecated)
    souls/
      SoulsList.tsx              — multi-select + Bulk Run + Bulk Assign Coven + soulprint search
      SoulDetail.tsx             — Soulprint tab + Issue Token + Coven Assign + Run Errand link
      IssueTokenModal / CovenAssignModal
      soulprintFilter.ts         — DSL parser (os.family=debian / kernel.version=6.*)
    plugins/                     — Sigil allow-list (PluginsList/Detail/RegisterForm)
    errands/
      ErrandsList.tsx            — history list (no New Errand — Run Wizard is primary)
      ErrandDetail.tsx           — Output/Params/Events tabs
      ErrandNewForm.tsx          — DEPRECATED: deprecation banner, route kept for backward-compat
      schemas.ts                 — Zod discriminated-union (shell/exec/custom)
    errandRuns/
      ErrandRunsList.tsx         — multi-target Errand history
      ErrandRunDetail.tsx        — progress + per-host + SSE/polling + Cancel
      status.ts
    push/
      PushApply.tsx              — DEPRECATED: deprecation banner
    pushRuns/
      PushRunsList.tsx
      PushRunDetail.tsx
      status.ts
    tides/
      TidesList.tsx
      TideDetail.tsx             — progress + Surge timeline + state_commit_error
      status.ts
    beacons/                     — Vigils / Decrees / OracleFires
    rbac/
      RbacPage.tsx               — Roles + Permissions + Operator-assignments (CRUD)
      schemas.ts / permissions.ts / errors.ts / PermissionsEditor.tsx
      CreateRoleModal / EditPermissionsModal / DeleteRoleModal / AssignRoleModal
    audit/
      AuditLog.tsx               — filter type + correlation_id + actor
    App.tsx                      — routes (including deprecated hidden routes /errands/new, /push)
  test/
    *.test.tsx                   — vitest unit + integration
```

## Principles

1. **Run Wizard is the primary entry point.** Every work run (scenario+Tide /
   Errand multi-target / Push) goes through `/run`. Standalone Errand/Push pages
   are hidden routes with a deprecation banner.
2. **DynamicInputBuilder for fallback input.** When a scenario/module has no
   `input_schema` — use the form-based UI (key+type+value), NOT a raw JSON
   textarea. ScenarioInputFields for typed input_schema stays primary.
3. **Graceful API degradation.** On 404/501/network-fail — fall back to text
   input or disable the feature (never crash the UI).
4. **Polling every 3s for running** (Tide/ErrandRun/PushRun detail). SSE
   EventSource is optional — on 404/auth-fail fall back to polling.
5. **JWT auth** — Bearer token in the Authorization header (via AuthProvider).
   Browser-native EventSource does NOT send Authorization → SSE endpoints need a
   query-token or cookie auth (backend follow-up).
6. **i18n / UI language (react-i18next + RU/EN toggle, hybrid lazy-load):**
   - Library: `react-i18next` + `i18next` + `i18next-http-backend`. Init in
     `src/i18n/index.ts` (imported from `src/main.tsx` and `src/test/setup.ts`).
     Languages: `en` (default + fallback) / `ru`; choice persisted in
     `localStorage('lang')`.
   - **Hybrid lazy-load architecture** (many languages without bloating the JS
     bundle):
     - **Default `en` — bundled inline:** lives in `src/i18n/locales/en/<ns>.json`,
       an eager-glob loads ONLY `en` into the JS bundle → instant first render,
       no flash. The namespace list is derived from the `en` files.
     - **`ru` + future — static in `public/locales/<lang>/<ns>.json`:** fetched
       over HTTP via `i18next-http-backend`
       (`loadPath: ${BASE_URL}locales/{{lng}}/{{ns}}.json`) ONLY when switching to
       that language. They never enter the JS bundle (after build they live in
       `dist/locales/<lang>/`, not in a JS chunk). `partialBundledLanguages: true`
       mixes inline-`en` + backend.
   - **Add a language:** drop `public/locales/<lang>/*.json` + add the code to
     `SUPPORTED_LANGS` (for the toggle). No locale rebuild needed for non-default.
   - Namespace structure (identical across en/ru): `common`, `forms`, `errors`,
     `pages`, `admin`, `souls`, `incarnations`, `run`, `runhistory`, `beacons`,
     `cadences`, `synods`, `notifications`.
   - **Accessing a key:** `const { t } = useTranslation();` then `t('create')`
     (default-ns `common`) or with an explicit ns via a colon — `t('errors:generic')`,
     `t('forms:destroyTitle', { name })`, `t('pages:noRoles')`.
   - **Pure (non-hook) functions** — error helpers (`rbac/errors.ts`,
     `services/errors.ts`, `RevokeArchonModal.prettyError`) use the global
     instance: `import i18n from '../../i18n'; const t = i18n.t.bind(i18n);`.
   - **Switcher:** Settings → Appearance
     (`src/pages/settings/AppearanceSettings.tsx`, the Language section next to
     Theme and Font) — NOT the Topbar. `LangToggle.tsx` still exists and is what
     `i18n.test.tsx` renders, but it is no longer mounted in the shell. Switching
     goes through `changeLang(lng)` from `src/i18n` (persist +
     `i18n.changeLanguage`, returns the ns-load promise). While a non-default
     language loads async the buttons are `disabled` (guards against a double
     click); until it resolves i18next keeps the current strings — no flash/crash.
   - **Translation rule:** everything a reader reads is translated. A string stays
     English only when the English word **is** the term.
     - **Translated** (per-language en/ru values): buttons/actions, hints/
       descriptions, errors, empty-states, confirm texts, loading/"no data", **and
       all structural labels — nav items, group headers, section headers, page
       titles, breadcrumb suffixes, tab names, table column headers.**
     - **Not translated** (English-identical in both locales): entity names of the
       dictionary (Archon / Keeper / Souls / Coven / Tide / Surge / Vigil /
       Portent / Oracle / Decree / Sigil / Errand / ErrandRun / Acolyte /
       Service / Incarnation / Soulprint / Choir / Voyage / Passage / Plugin /
       RBAC), technical identifiers and wire field names (SID / AID / ULID /
       git-ref / CEL / `dry_run` / `self_health`), placeholder example values
       (`redis-prod`, `os.family=debian`), status enum values
       (pending/running/succeeded/builtin), and proper names (font families).
     - ⚠️ **"It is a structural label" is NOT a reason to leave English.** That was
       the old rule; it produced a half-translated Russian UI and was reversed in
       **NIM-213**. Nav, tabs and column headers are translated like everything
       else — only entity names inside them stay English (`Souls`, `Covens`).
     - **Enforced by a guard test**, not by convention alone:
       `src/test/i18nTranslationRule.test.ts` fails when a key is identical in both
       locales and is not on the explicit allow-list (grouped by reason: entity
       name / technical identifier / placeholder / status value / proper name). It
       also fails on stale allow-list entries and on `{{placeholder}}` drift
       between locales. Adding an English-identical key means either translating
       it or adding it to that list with the category that justifies it.
     - **Structural labels live in i18n, not in JSX.** Nav items and table headers
       carry a `labelKey` (see `Sidebar.tsx`, `RunsFeed.tsx` `SEGMENTS`); generic
       column headers reuse the shared `common:col*` keys.
     - **So do field labels and a11y text.** The locale comparison above can only
       see strings that reached a locale file, so a label hardcoded in the markup
       slips past it and stays English in Russian forever. The same guard test
       therefore scans `src/pages` + `src/components` for three patterns —
       `<span className={styles.metaKey}>…</span>`, `aria-label="…"` and
       `title="…"` — and fails on any literal that is not on its explicit
       inventory (wire field name / technical identifier / proper name), plus on
       stale inventory entries. The scan stops at those three patterns on
       purpose: over all of JSX it is a false-positive generator (NIM-259).
     - **Detail panels come in two flavours.** Panels that label values with prose
       (`Created at`, `Updated at`) are translated; panels that dump a
       payload key beside its value (`started_at`, `pkg_mgr`, `scope_size`) keep
       the wire name, because the label names the field the value came from.
     - **A new key's English value must match the literal it replaces.** The suite
       renders `en` and a good part of it queries by accessible name
       (`getByLabelText('Incarnation regex')`), so rewording English while moving
       a string into i18n breaks tests that have nothing to do with the change.
       Reuse an existing key only when its `en` value is character-identical.
   - **Add a key:** add it to **both** files — `en` in
     `src/i18n/locales/en/<ns>.json` + `ru` in `public/locales/ru/<ns>.json` (both
     required). A key in only one locale is caught by the ns-key-sync test
     (`src/test/i18n.test.tsx` reads `ru` from `public/locales/ru` via fs).
   - **Tests on locale-dependent text:** match by `data-testid` (stable across
     languages), not by a button string. Existing tests match `en` as the default
     output (`src/test/setup.ts` resets the language to `en` after each test).
   - Do NOT translate entity names into Russian.
7. **Zod + React Hook Form** for all forms.
8. **TanStack Query** for all fetches + invalidate on mutate.

## Commands

```bash
npm run dev           # vite dev on 5173 (served under /ui/)
npm run lint          # eslint
npm test              # vitest run (CI mode, one pass)
npm run test:watch    # vitest watch
npm run test:e2e      # playwright e2e
npm run gen:api       # openapi-typescript from vendor/openapi/keeper.yaml (+ gen-constraints)
npm run build         # tsc -b && vite build (production)
```

## CI

`.github/workflows/ci.yml` runs on pushes to the integration targets (`main`,
`release/**`) and on pull requests into them. Four **independent** jobs — no
`needs:` between them, so one failure never erases the other three answers:

| job       | what it runs                            |
|-----------|-----------------------------------------|
| `lint`    | `npm run lint`                          |
| `test`    | `npm test` (vitest, 112 files)          |
| `build`   | `npm run build` — this is the type gate too |
| `codegen` | `npm run gen:api` + fail on a git diff  |

The workflow is a thin wrapper over the scripts above: keep the checks in
`package.json`, not in YAML.

**Ticket branches (`feat/**`) are NOT gated by CI** — the verdict arrives once the
branch is squash-merged into `release/<REL>`. So run the gate locally before
merging: `npm ci && npm run lint && npm test && npm run build`.

**`npm run test:e2e` (Playwright) is NOT in CI.** It needs a live stand — keeper on
:8080 with Postgres/Redis/Vault, plus vite on :5173 (see `playwright.config.ts`,
`e2e/README.md`). Run it locally against a stand.

**Pairing the bundle with the core repo's vendored copy** (`keeper/internal/webui/assets`)
is not checked here either — it needs both checkouts and lives on the core side.

`.npmrc` pins `legacy-peer-deps=true`. Do not delete it without reading the reason
in the file: without it `npm ci` fails outright on a clean checkout, because
`openapi-typescript@7.13.0` caps its `typescript` peer at `^5.x` and this repo is
on `typescript@6`.

## Updating the openapi types

When the backend changes the API:
1. Copy `cp ../soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml`.
2. `npm run gen:api` → refreshes `src/api/types.gen.ts`.
3. Replace any local types in `src/api/keeper.ts` with the generated ones (where
   they still exist as a fallback).

## Delegation

In a UI session the task usually arrives from the PM as a ready spec (what/where/
how). If a task is large or the scope is unclear — ask the PM for clarification,
don't invent it.

If it hits a backend limitation — STOP + flag needs_architect / a backend slice in
parallel (the PM decides).

## What NOT to do

- **Do NOT change the proxy** in `vite.config.ts`.
- **Do NOT break existing pages** (their tests rely on them).
- **Do NOT add borrowed config-management jargon** (master/minion/grain/...).
- **Do NOT show `ADR-NNN`** in user-visible text (JSDoc only).
- **Do NOT remove hidden routes** (`/errands/new`, `/push`) — backward-compat for
  direct links.
- **Do NOT change the backend** (a different repo).

## Open UI follow-ups

- `/runs` unified feed (UNION view across all run types: applies + tides +
  push runs + errand runs, with type/status/incarnation filters).
- Roster editing is the only host editing there is: `PATCH /v1/incarnations/:name/hosts`
  and the `spec.hosts[]` it edited were removed backend-side (NIM-330), and the UI
  that still called it went with them (NIM-435). A declared role is a Choir Voice —
  `ChoirsTab.tsx`; membership bind/unbind lives in `MembersPanel.tsx`, which since
  NIM-444 is also the vitals table — one list, a row per roster member.
- SSE auth handshake (query-token / cookie auth) so EventSource can carry auth.

## Environment

- Companion repo with its own git remote; depends on the vendored openapi from the
  core repo — sync is manual (`cp` + `npm run gen:api`).
