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
  Souls / Plugins / RBAC / Providers / Vigils / Decrees / Oracle fires / Tides /
  Errand runs / Push runs / Errands / Cadences / Synods / Notifications /
  Settings / Audit log).
- Broad unit + integration suite (~95 test files: vitest + @testing-library/react
  + jsdom), plus Playwright e2e smoke tests under `e2e/`.
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
      IncarnationDetail.tsx      — tabs: Data summary / Spec / State / Schema / Hosts / Drift / History
      IncarnationNewForm.tsx     — Create form + scenario dropdown + DynamicInputBuilder fallback
      SpecTab.tsx / StateTab.tsx / SchemaTab.tsx / HostsTab.tsx
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
     `providers`, `cadences`, `synods`, `notifications`.
   - **Accessing a key:** `const { t } = useTranslation();` then `t('create')`
     (default-ns `common`) or with an explicit ns via a colon — `t('errors:generic')`,
     `t('forms:addHostTitle', { name })`, `t('pages:noRoles')`.
   - **Pure (non-hook) functions** — error helpers (`rbac/errors.ts`,
     `services/errors.ts`, `RevokeArchonModal.prettyError`) use the global
     instance: `import i18n from '../../i18n'; const t = i18n.t.bind(i18n);`.
   - **Switcher:** `src/components/layout/LangToggle.tsx` (EN | RU), mounted in
     `Topbar.tsx` next to `ThemeToggle`. Switching goes through `changeLang(lng)`
     from `src/i18n` (persist + `i18n.changeLanguage`, returns the ns-load
     promise). While a non-default language loads async the buttons are `disabled`
     (guards against a double click); until it resolves i18next keeps the current
     strings — no flash/crash.
   - **Translation rule:**
     - **Change per language** (en/ru keys): buttons/actions, hints/descriptions,
       errors, empty-states, confirm texts, loading/"no data".
     - **Not translated** (English-identical in both locales OR hardcoded English):
       entity names (Archon / Keeper / Souls / Coven / Tide / Surge / Vigil /
       Portent / Oracle / Decree / Sigil / Errand / ErrandRun / Acolyte /
       Service / Incarnation / Soulprint / Plugin / RBAC), structural labels
       (nav / section headers / page titles / tab names / table column headers),
       technical identifiers (SID / AID / ULID / git-ref / CEL), status enum
       values (pending/running/succeeded). For English-identical strings
       ("Register" / "Issue token" / "Showing N of M") the value is the same
       English in both `en.json` and `ru.json` — that is how the `i18n.test.tsx`
       test checks key sync and that these stay unchanged.
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
- Hosts editing UI (backend `PATCH /v1/incarnations/:name/hosts` exists;
  `HostsTab.tsx` is still read-only).
- SSE auth handshake (query-token / cookie auth) so EventSource can carry auth.

## Environment

- Companion repo with its own git remote; depends on the vendored openapi from the
  core repo — sync is manual (`cp` + `npm run gen:api`).
