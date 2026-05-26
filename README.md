# Soul Stack Web — UI for Soul Stack Keeper API

Companion-репозиторий к [`soul-stack`](https://github.com/co-cy/soul-stack) (core =
Go-ядро: keeper/soul/soul-lint/soulctl). Архитектурное решение — [ADR-035 distribution
split](https://github.com/co-cy/soul-stack/blob/main/docs/architecture.md#adr-035-distribution-split--core-api--cli-vs-web-ui).
Parity-аналог: **SaltStack ↔ salt-manager**, **OpenStack ↔ Horizon**,
**Kubernetes ↔ Dashboard**.

Извлечён 2026-05-26 из `soul-stack/ui/` scaffold (5 страниц, 7 тестов,
lint+build зелёные на момент выноса).

## What's new (Iteration 2, 2026-05-26)

Sync OpenAPI from core commit `36c719d` (Errand E4 + предшествующие).
Подключение к свежим endpoint-ам:

- `POST /v1/souls/{sid}/exec` — Errand sync (200) / async (202 + poll).
- `GET /v1/errands`, `GET /v1/errands/{errand_id}` — Errand history + poll.
- `POST /v1/push/apply`, `GET /v1/push/{apply_id}` — push-прогон по SSH.
- `POST /v1/operators`, `POST /v1/operators/{aid}/revoke`,
  `POST /v1/operators/{aid}/issue-token` — Archon admin.

Страницы (4 новых slot-а в Sidebar):

- `/audit` — placeholder, `GET /v1/audit` ещё не выставлен в OpenAPI.
- `/archons` — create-форма (показывает выданный JWT один раз),
  issue-token-форма, revoke-форма с confirmation. `GET /v1/operators`
  отсутствует — таблицы существующих Архонтов нет.
- `/archons/:aid` — placeholder для будущего GET-by-aid.
- `/push` — форма push-apply (inventory + destiny_ref + ssh_provider +
  JSON-input + cleanup_stale) → 202 → polling до терминала → per-host
  summary-таблица.
- `/errand/exec` — форма Errand-а (sid + module datalist + JSON-input +
  timeout + dry_run). 200 sync → render; 202 async → polling до терминала.
  stdout/stderr в collapsible `<details>` с truncation-marker.
- `/errand/history` — list с фильтрами (sid / module-substring / status /
  started_after) + pagination + modal «View full» с полным stdout/stderr.

Тесты: 12 → 20.

## What's new (Iteration 1, 2026-05-26)

Подключение к свежим endpoint-ам core (commit 549be43):

- `GET /v1/souls/{sid}` — single Soul fetch (заменяет старое list-and-find).
- `GET /v1/souls/{sid}/soulprint` — typed SoulprintReport (ADR-018);
  410 → graceful «soulprint ещё не получен».
- `?coven=<x>` server-side фильтр для `GET /v1/incarnations`.
- `?coven=X&coven=Y` multi-OR-фильтр для `GET /v1/souls`
  (`style: form, explode: true`).

Страницы:

- `/souls/:sid` — раскрыто из плейсхолдера в полноценный detail с вкладками
  **Overview / Soulprint / History** (last — TODO до появления
  `GET /v1/souls/{sid}/history`).
  Soulprint-tab рендерит `typed_facts` (os/kernel/cpu/memory/network) +
  visual-warn на skew `collected_at` ↔ `received_at` > 10 минут.
- `/incarnations` — серверный coven-filter (заменил клиентский
  substring); inline-валидация coven-pattern.
- `/souls` — multi-coven фильтр (CSV `prod, redis-prod, …`).
- `/login` — help-text про paste-JWT и про отсутствие
  `/v1/auth/login` (ADR-014 amendment in progress).

## Sync with core

OpenAPI вендорится в `vendor/openapi/keeper.yaml`, чтобы dev-окружение
получало актуальные типы без core-репо. Обновление — manual:

```bash
cp ../soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml
npm run gen:api
```

`vendor/openapi/keeper.yaml` коммитится в репо; `src/api/types.gen.ts` —
generated, в `.gitignore`.

## Known gaps

- `/v1/auth/login` ещё не выставлен (требует ADR-014 amendment).
  Текущий UX — paste JWT.
- `GET /v1/souls/{sid}/history` нет в core — вкладка History в
  SoulDetail показывает TODO.
- `GET /v1/audit` нет в core — `/audit` рендерит placeholder.
- `GET /v1/operators` (list) нет в core — `/archons` без таблицы
  существующих, только create/issue/revoke по AID.
- `?coven_any=` для incarnations (multi-OR) — пост-MVP в core.

SPA-фронтенд Keeper Operator API. Отдельный артефакт (Variant B), не embedded
в `keeper`-бинарь. Поднимается локально для разработки и серверится
production-build-ом отдельно (deployment-слайс — позже).

## Стек

- React 19 + TypeScript + Vite
- React Router 7
- TanStack Query (server state)
- React Hook Form + Zod (валидация форм)
- lucide-react (иконки)
- Vitest + @testing-library (тесты)
- ESLint flat config

## Quickstart

```bash
cd ui
npm install
npm run dev       # vite dev-server на http://localhost:5173
npm run build     # production-build в ui/dist
npm test          # vitest run
npm run lint      # eslint .
```

`npm run dev` проксирует `/v1`, `/healthz`, `/readyz`, `/openapi.yaml` на
`http://localhost:8080` (по умолчанию). Адрес Keeper-а переопределяется:

```bash
VITE_KEEPER_API=http://keeper.internal:8080 npm run dev
```

## Auth-модель

ADR-013/014: Authorization: Bearer JWT. В UI оператор вставляет JWT
вручную на `/login` (источник — bootstrap-файл `keeper init --archon=...`
или re-issued через `POST /v1/operators/{aid}/issue-token`). Токен хранится
в `localStorage` (`soul-stack.jwt`); auto-clear при истечении `exp`
парсится клиентом, авторитетная проверка — на Keeper-е. 401 → clear + redirect
на `/login`.

Существенно: в текущем `docs/keeper/openapi.yaml` **нет login/password
endpoint-а** — это сознательно (см. ADR-013). При появлении такого
endpoint-а в openapi заменим `/login`-форму на нормальный credential flow.

## Генерация TS-типов из OpenAPI

`npm run gen:api` запускает `openapi-typescript` против
`vendor/openapi/keeper.yaml` и кладёт результат в `src/api/types.gen.ts`:

```bash
npm run gen:api
```

Не запускается автоматически в `vite build` — оператор обновляет вручную
при изменении openapi (явный пайплайн, никакого скрытого магического
кодогена). Источник правды для типов — generated-файл; `src/api/keeper.ts`
re-export-ит схемы через `components['schemas']['…']`.

## Реализованные страницы

| Path | Назначение |
| ---- | ---------- |
| `/login` | Вход Архонта по JWT-токену (ping-валидация). |
| `/incarnations` | Список: name / service / status / last_drift_check / updated_at. Фильтры status + coven (server-side, exact). |
| `/incarnations/:name` | Detail: вкладки State / Spec / History / Drift (кнопка check-drift + DriftReport). |
| `/souls` | Список: sid / status / transport / covens / last_seen_at. Фильтры status + transport + covens (server-side, CSV OR). |
| `/souls/:sid` | Detail: вкладки Overview / Soulprint (typed_facts ADR-018) / History (TODO). |
| `/audit` | Placeholder (endpoint `GET /v1/audit` отсутствует в OpenAPI). |
| `/archons` | Create / Issue-token / Revoke формы для Архонтов; `GET /v1/operators` отсутствует, таблицы нет. |
| `/archons/:aid` | Placeholder (нет `GET /v1/operators/{aid}` в OpenAPI). |
| `/push` | Push apply form → 202 → poll → per-host summary. |
| `/errand/exec` | Errand exec form (sync 200 / async 202 + poll). |
| `/errand/history` | Список Errand-ов с фильтрами + modal full-view. |

## TODO (out of pilot, не делаем здесь)

- Полный CRUD: создание incarnation / создание Soul / coven-assign UI / role-management.
- `/applies/:id` страница live-следящая за apply (требует SSE-endpoint).
- Bulk-actions (выбор N incarnation-ов / N Souls).
- Темизация: ручной toggle theme. CSS-переменные уже готовы
  (`[data-theme="dark"]` на `<html>`).
- Брендинг: SS-mark в `Topbar` — placeholder, нужен финальный логотип.

## Дизайн-система

Адаптировано из внутреннего референса salt-manager
(`saltgui-design-system`, отдельный репо). Что взяли:

- `colors_and_type.css` → `src/styles/tokens.css` (CSS-токены, шрифты IBM
  Plex Sans + JetBrains Mono).
- HTML preview-компоненты (Buttons / Inputs / Cells / Dots / Footer)
  → `src/components/primitives/` (один .tsx + .module.css на компонент).

Что **re-skin-нули**:

- Вокабуляр: `minion` → `Soul`, `grain` → `Soulprint`, `pillar` → `Essence`,
  `state` (как Salt-DSL) → `Destiny`, `cluster` → `incarnation`/`Coven`,
  `job/pipeline` (как Salt-pipeline) → `apply`/`scenario`. См.
  `docs/naming-rules.md`.
- Brand-mark: `dba` → `SS` (Soul Stack), accent-colour сохранена.
- Удалены db-brand цвета (`--db-redis` и т.п.) — Soul Stack
  system-agnostic.
- `--prod` semantic-цвет (кричаще-красный) заменён на `--danger`
  + добавлен `--info` для applying/provisioning.
- Keyframes `ds-pulse` → `ss-pulse` (соглашение Soul Stack).

Не переносили: `components-jobs.html` (другой smell у scenario-apply,
отдельный слайс), `components-pipeline.html`, тематические `colors-*.html`
и type-scale (pure design reference).

См. подробное соответствие в
[`src/components/primitives/README.md`](src/components/primitives/README.md).

## Структура

```
ui/
├── eslint.config.mjs
├── index.html
├── package.json
├── README.md                            # этот файл
├── vendor/
│   └── openapi/
│       ├── keeper.yaml                  # synced from core (commit-id в vendor/openapi/README.md)
│       └── README.md
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── api/
│   │   ├── client.ts                    # fetch-wrapper, ApiError, 401-handler
│   │   ├── tokenStore.ts                # localStorage + JWT exp parsing
│   │   └── keeper.ts                    # typed wrappers поверх Operator API
│   ├── components/
│   │   ├── JsonViewer.tsx
│   │   ├── ProtectedRoute.tsx
│   │   ├── status.ts                    # status → DotKind / Badge tone
│   │   ├── layout/
│   │   │   ├── Shell.tsx                # grid topbar + sidebar + main + footer
│   │   │   ├── Sidebar.tsx              # навигация (NavLink + lucide иконки)
│   │   │   └── Topbar.tsx               # бренд + user-menu (logout)
│   │   └── primitives/
│   │       ├── README.md                # карта saltgui → Soul Stack
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Dot.tsx
│   │       ├── Cell.tsx
│   │       ├── Badge.tsx
│   │       └── Footer.tsx
│   ├── hooks/
│   │   ├── AuthProvider.tsx
│   │   └── useAuth.ts
│   ├── pages/
│   │   ├── common.module.css
│   │   ├── Login.tsx
│   │   ├── incarnations/
│   │   │   ├── IncarnationsList.tsx
│   │   │   └── IncarnationDetail.tsx
│   │   └── souls/
│   │       ├── SoulsList.tsx
│   │       └── SoulDetail.tsx
│   ├── styles/
│   │   ├── tokens.css                   # CSS-переменные (light/dark)
│   │   └── base.css                     # globalsреsets
│   └── test/
│       ├── setup.ts
│       ├── renderWithProviders.tsx
│       ├── fetchMock.ts
│       ├── Login.test.tsx
│       ├── IncarnationsList.test.tsx
│       ├── IncarnationDetail.test.tsx
│       └── SoulsList.test.tsx
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── vitest.config.ts
```

## Лексика Soul Stack

ВСЯ лексика UI — по [`docs/naming-rules.md`](../docs/naming-rules.md):

- Keeper / Souls / Coven / Soulprint / Destiny / Essence / Archon / AID
- Никаких `minion` / `grain` / `pillar` / `cluster` (как Salt-DSL).
- `incarnation` — runtime-инстанс Service-а; имя incarnation = корневая
  Coven-метка (ADR-008).
- `apply` — прогон scenario, не «job».
- `scenario` — операция над state (create / restart / upgrade / ...),
  не «pipeline».
- `Scry` — drift-scan (ADR-031), не «monitor».
