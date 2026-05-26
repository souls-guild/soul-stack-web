# Soul Stack Web — UI for Soul Stack Keeper API

Companion-репозиторий к [`soul-stack`](https://github.com/co-cy/soul-stack) (core =
Go-ядро: keeper/soul/soul-lint/soulctl). Архитектурное решение — [ADR-035 distribution
split](https://github.com/co-cy/soul-stack/blob/main/docs/architecture.md#adr-035-distribution-split--core-api--cli-vs-web-ui).
Parity-аналог: **SaltStack ↔ salt-manager**, **OpenStack ↔ Horizon**,
**Kubernetes ↔ Dashboard**.

Извлечён 2026-05-26 из `soul-stack/ui/` scaffold (5 страниц, 7 тестов,
lint+build зелёные на момент выноса).

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

Скрипт `scripts/gen-api.sh` запускает `openapi-typescript` против
`../docs/keeper/openapi.yaml` и кладёт результат в
`src/api/types.gen.ts`. Запуск:

```bash
cd ui
npm run gen:api
```

Не запускается автоматически в `vite build` — оператор обновляет вручную
при изменении openapi (явный пайплайн, никакого скрытого магического
кодогена).

До первой генерации в `src/api/keeper.ts` есть узкий ручной surface
(зеркало нужных схем). После `gen:api` можно переключаться на
`import type { components } from './types.gen'`.

## Реализованные страницы (pilot)

| Path | Назначение |
| ---- | ---------- |
| `/login` | Вход Архонта по JWT-токену. |
| `/incarnations` | Список incarnation-ов: name / service / status / last_drift_check / updated_at. Фильтры status + coven (substring). |
| `/incarnations/:name` | Detail: вкладки State (jsonb), Spec (jsonb), History (state_history timeline), Drift (кнопка check-drift + DriftReport). |
| `/souls` | Список Souls: sid / status / transport / covens / last_seen_at. Фильтры status + transport + coven (exact). |
| `/souls/:sid` | Минимальный detail (плейсхолдер Soulprint — endpoint в MVP openapi не выставлен). |

Сайдбар: пункт «Audit» — placeholder (disabled).

## TODO (out of pilot, не делаем здесь)

- Полный CRUD: создание incarnation / создание Soul / coven-assign UI / role-management.
- `/applies/:id` страница live-следящая за apply (требует SSE-endpoint).
- Soulprint detail (`GET /v1/souls/{sid}/soulprint`, ADR-018) — open question
  в openapi.yaml: нет `soul.get` permission и endpoint-а в MVP.
- Audit-log viewer.
- Push-операции (`POST /v1/push/apply`).
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
├── scripts/
│   └── gen-api.sh                       # openapi-typescript → types.gen.ts
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
