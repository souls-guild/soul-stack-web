# CLAUDE.md — Soul Stack UI

Файл-конфигурация для Claude Code в **companion-repo Soul Stack UI**
(React 19 + Vite + TanStack Query + React Hook Form + Zod + lucide-react).

**Core-репо** (где живёт backend): `/home/co-cy/vscode/soulstack/soul-stack/`.
**Companion plugins**: `/home/co-cy/vscode/soulstack/soul-stack-plugins/`.

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
      Sidebar.tsx      — primary nav: Run (top) / Registry / Oracle / Runs / Audit / Help
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
6. **i18n / язык UI (react-i18next + переключатель RU/EN, hybrid lazy-load):**
   - Библиотека: `react-i18next` + `i18next` + `i18next-http-backend`. Init —
     `src/i18n/index.ts` (импортируется в `src/main.tsx` и в `src/test/setup.ts`).
     Языки: `ru` (default + fallback) / `en`; выбор — `localStorage('lang')`.
   - **Архитектура hybrid lazy-load** (много языков без раздувания JS-бандла):
     - **Default `ru` — bundled inline:** живёт в `src/i18n/locales/ru/<ns>.json`,
       eager-glob грузит ТОЛЬКО ru в JS-бандл → мгновенный первый рендер, без
       мигания. Список namespace выводится из ru-файлов.
     - **`en` + будущие — static в `public/locales/<lang>/<ns>.json`:** фетчатся
       по HTTP через `i18next-http-backend` (`loadPath: /locales/{{lng}}/{{ns}}.json`)
       ТОЛЬКО при переключении на язык. В JS-бандл НЕ попадают (после build —
       `dist/locales/<lang>/`, не в JS-чанке). `partialBundledLanguages: true`
       миксует inline-ru + backend.
   - **Добавить язык:** положить `public/locales/<lang>/*.json` + добавить код в
     `SUPPORTED_LANGS` (для тоггла). Ребилд локалей НЕ нужен (для не-default).
   - Namespace-структура (одинакова в ru/en): `common` (кнопки/действия),
     `forms` (поля/hint/валидация/titles), `errors` (pretty-error),
     `pages` (page-prose, empty-states, confirm-диалоги).
   - **Доступ к ключу:** `const { t } = useTranslation();` затем `t('create')`
     (default-ns `common`) или с явным ns через двоеточие — `t('errors:generic')`,
     `t('forms:addHostTitle', { name })`, `t('pages:noRoles')`.
   - **Pure-функции (не-hook)** — error-хелперы (`rbac/errors.ts`,
     `services/errors.ts`, `RevokeArchonModal.prettyError`) используют
     глобальный инстанс: `import i18n from '../../i18n'; const t = i18n.t.bind(i18n);`.
   - **Switcher:** `src/components/layout/LangToggle.tsx` (RU | EN), смонтирован
     в `Topbar.tsx` рядом с `ThemeToggle`. Переключение — `changeLang(lng)` из
     `src/i18n` (persist + `i18n.changeLanguage`, возвращает Promise загрузки ns).
     На время async-загрузки non-default языка кнопки `disabled` (защита от
     двойного клика); до резолва i18next держит текущие строки — мигания/краша нет.
   - **Правило перевода:**
     - **Меняются от языка** (ru/en ключи): кнопки/действия, hint/описания,
       ошибки, empty-states, confirm-тексты, loading/«нет данных».
     - **НЕ переводятся** (English-identical в обоих locale ИЛИ хардкод English):
       имена сущностей (Archon / Keeper / Souls / Coven / Tide / Surge / Vigil /
       Portent / Oracle / Decree / Sigil / Errand / ErrandRun / Acolyte /
       Service / Incarnation / Soulprint / Plugin / RBAC), structural-лейблы
       (nav / section headers / page titles / tab names / table column headers),
       технические идентификаторы (SID / AID / ULID / git-ref / CEL),
       enum-значения статусов (pending/running/succeeded). Для English-identical
       строк («Register» / «Issue token» / «Showing N of M») значение в `ru.json`
       и `en.json` одинаковое English — так тест `i18n.test.tsx` проверяет
       синхронность ключей и неизменность.
   - **Добавить ключ:** дописать в **оба** файла — ru в
     `src/i18n/locales/ru/<ns>.json` + en в `public/locales/en/<ns>.json` (оба
     обязательны). Ключ только в одном locale ловится ns-key-sync тестом
     (`src/test/i18n.test.tsx` читает en из `public/locales/en` через fs).
   - **Тесты на locale-зависимый текст:** матчить по `data-testid` (устойчиво к
     языку), а не по строке кнопки. Существующие тесты матчат ru как default-вывод
     (`src/test/setup.ts` сбрасывает язык на `ru` после каждого теста).
   - НЕ переводить имена сущностей на русский (была ошибка с «Архонты»).
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
1. Скопировать `cp /home/co-cy/vscode/soulstack/soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml`.
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

См. `/home/co-cy/vscode/soulstack/soul-stack/.pm/handoff/2026-05-27-resume.md` →
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
