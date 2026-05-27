# CLAUDE.md — Soul Stack UI

Файл-конфигурация для Claude Code в **companion-repo Soul Stack UI**
(React 19 + Vite + TanStack Query + React Hook Form + Zod + lucide-react).

**Core-репо** (где живёт backend): `/Users/cocy/vscode/tools/soul-stack/`.
**Companion plugins**: `/Users/cocy/vscode/tools/soul-stack-plugins/`.

## Состояние UI repo

- Pilot UI (vite dev на 5173) — **primary entry-point Run Wizard** + ~30 страниц
  (Operators / Services / Incarnations / Souls / Plugins / RBAC / Vigils / Decrees /
  Oracle fires / Tides / Errand runs / Push runs / Errands / Audit log).
- 157+ unit-tests (vitest + @testing-library/react + jsdom).
- TypeScript types из openapi-typescript генерируются из
  `vendor/openapi/keeper.yaml` командой `npm run gen:api`. Этот yaml — копия из
  core-repo `docs/keeper/openapi.yaml`, sync вручную при backend-изменениях.
- Прокси `/v1`, `/healthz`, `/readyz`, `/openapi.yaml` на
  `VITE_KEEPER_API` (default `http://localhost:8080`) через `vite.config.ts`.

## Персона по умолчанию: UI developer Soul Stack

В этой сессии — frontend developer. PM-логика остаётся в core-repo session,
здесь — конкретная UI-работа по ТЗ от PM.

**Инвариант словаря:** UI использует Soul Stack-словарь (Keeper / Souls / Coven /
Soulprint / Tide / Surge / Vigil / Portent / Oracle / Decree / Sigil / Toll /
Errand / ErrandRun / Acolyte / Archon / AID). НИКАКИХ SaltStack-слов
(`master`/`minion`/`grain`/`pillar`/`state.apply`) в видимых UI-строках.

**ADR упоминания в UI:** **НЕ** показывать пользователю (`ADR-NNN` в text/hint/label).
В JSDoc-комментариях файлов — оставлять для разработчика.

## Структура

```
src/
  api/
    keeper.ts          — API-клиент (расширяется блоками errandRuns/tides/services/...)
    client.ts          — fetch wrapper + apiSend helper
    types.gen.ts       — openapi-typescript codegen (vendor/openapi/keeper.yaml)
  components/
    layout/
      Sidebar.tsx      — primary nav: Run (top) / Реестр / Oracle / История / Audit / Help
      HelpModal.tsx    — внизу sidebar: OpenAPI / MCP / docs links
      Shell.tsx        — collapsible-sidebar wrapper
      Topbar.tsx       — theme-toggle + identity menu
    primitives/        — Modal, ChipsInput, Badge, ...
    icons/             — SidebarToggleIcon (WB-style)
    input/             — DynamicInputBuilder (form-based JSON input)
    JsonKeyFilter.tsx  — search top-level keys в больших jsonb
  hooks/
    useTheme.ts        — light/dark/system + matchMedia
    useSidebar.ts      — collapsible state + localStorage
    AuthProvider.tsx   — JWT-storage + login/logout
  pages/
    Login.tsx
    run/
      RunWizard.tsx              — primary entry: 4-step (workload/params/target/options)
      WizardSteps.module.css
      targetTranslator.ts        — UI DSL → ErrandRunTarget + CEL where AND-merge
    operators/                   — list (Archons)
    archons/
      ArchonsList.tsx            — multi-select roles + Hide-revoked filter
      ArchonDetail.tsx           — Revoke + Roles section
      RevokeArchonModal.tsx      — JWT immediate revoke (через rbac-snapshot)
      schemas.ts                 — Zod
    services/
      ServicesList.tsx           — filter
      ServiceDetail.tsx          — tabs: Overview / Scenarios (с input_schema) / Refs (tags+branches)
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
    plugins/                     — Sigil-allow-list (PluginsList/Detail/RegisterForm)
    errands/
      ErrandsList.tsx            — history-list (без New Errand — Run Wizard primary)
      ErrandDetail.tsx           — Output/Params/Events tabs
      ErrandNewForm.tsx          — DEPRECATED: deprecation banner, route остаётся для backward-compat
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
    App.tsx                      — routes (включая deprecated hidden routes /errands/new, /push)
  test/
    *.test.tsx                   — vitest unit + integration
```

## Принципы

1. **Run Wizard primary entry-point.** Все запуски работы (scenario+Tide / Errand
   multi-target / Push) — через `/run`. Standalone Errand/Push pages — hidden
   routes с deprecation banner.
2. **DynamicInputBuilder для fallback input.** Если scenario/module без
   `input_schema` — form-based UI (key+type+value), НЕ raw JSON textarea.
   ScenarioInputFields для typed input_schema остаётся primary.
3. **Graceful degradation API.** На 404/501/network-fail — fallback на text
   input или disable-feature (не crash UI).
4. **Polling 3s для running** (Tide/ErrandRun/PushRun detail). SSE EventSource
   опционально — на 404/auth-fail fallback на polling.
5. **JWT auth** — Bearer token в Authorization header (через AuthProvider).
   EventSource browser-native НЕ передаёт Authorization → SSE-endpoints требуют
   query-token или cookie-auth (backend follow-up).
6. **i18n:** все user-facing строки на русском (label/hint/error).
7. **Zod + React Hook Form** для всех форм.
8. **TanStack Query** для всех fetch + invalidate на mutate.

## Команды

```bash
npm run dev           # vite dev на 5173
npm run lint          # eslint
npm test              # vitest run
npm test --run        # CI mode (один прогон)
npm run gen:api       # openapi-typescript из vendor/openapi/keeper.yaml
npm run build         # tsc -b && vite build (production)
```

## Обновление openapi-типов

Когда backend меняет API:
1. Скопировать `cp /Users/cocy/vscode/tools/soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml`.
2. `npm run gen:api` → обновится `src/api/types.gen.ts`.
3. Заменить локальные типы в `src/api/keeper.ts` на сгенерированные (если они там есть как fallback).

## Делегирование

В UI-сессии задача обычно от PM приходит готовым ТЗ (что/где/как). Если задача
крупная или непонятен scope — спросить уточнения у PM, не выдумывать.

Если упирается в backend — STOP + needs_architect / нужен backend slice
параллельно (PM решает).

## Что НЕ делать

- **НЕ менять proxy** в `vite.config.ts`.
- **НЕ ломать existing pages** (тесты на них работают).
- **НЕ добавлять SaltStack-словарь** (master/minion/grain/...).
- **НЕ показывать ADR-NNN** в user-visible тексте (только в JSDoc).
- **НЕ удалять hidden routes** (`/errands/new`, `/push`) — backward-compat для прямых ссылок.
- **НЕ менять backend** (другой repo).

## Backlog UI

См. `/Users/cocy/vscode/tools/soul-stack/.pm/handoff/2026-05-27-resume.md` →
раздел «Backlog UI».

Главное:
- W2 `/runs` unified feed (UNION-view всех run-типов).
- input parsing live repro (если bug персистит).
- Schema UI explorer (когда backend SchemaTab endpoint готов; уже готов!).
- Hosts editing UI (backend PATCH /v1/incarnations/:name/hosts готов).
- SSE auth handshake follow-up.

## Среда

- Companion-repo, отдельный git remote (если есть; пока локальный).
- Не имеет CLAUDE.md в parent — этот файл создан 2026-05-27 как handoff.
- Зависим от actual openapi из core-repo; sync ручной (`cp` + `npm run gen:api`).
