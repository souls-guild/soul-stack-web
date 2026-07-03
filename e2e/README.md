# UI-smoke (Playwright)

Дымовые UI-тесты против **живого локального стенда** Soul Stack (без моков API).
Прогоняют реальную навигацию/формы/фильтры/диалоги через Keeper Operator API.

Это **отдельная UI-плоскость**, ортогональная backend-лестнице L0–L3c: имя плоское
(«ui-smoke»), а не метафора-сущность (ADR-039 — без новой сущности словаря).

## Предпосылка: поднять стенд

Тесты НЕ поднимают Keeper. Подними стенд из core-репо:

```bash
cd ../soul-stack
make dev-provision   # PG + Vault + Redis + seed сервисов (hello-world, redis)
make dev-keeper      # Keeper Operator API на :8080
make dev-web         # (или npm run dev здесь) vite на :5173
```

Проверка: `GET http://127.0.0.1:8080/healthz` → 200, UI на http://localhost:5173/ui/.

## Запуск

```bash
npm run test:e2e        # headless прогон всех спек
npm run test:e2e:ui     # интерактивный Playwright UI
```

`globalSetup` (`e2e/global-setup.ts`):
1. Проверяет `GET :8080/healthz` == 200 (иначе — понятная ошибка с инструкцией).
2. Минтит Archon-JWT: `SMOKE_JWT` (env) → `make -C <core> dev-jwt` (с `VAULT_TOKEN=root`,
   т.к. в env оператора обычно prod-token) → fallback `/tmp/keeper-dev/archon-dev.jwt`.
3. Пишет `e2e/.auth/token.txt` (для API-засева) и `e2e/.auth/state.json`
   (storageState: localStorage `soul-stack.jwt` для origin `http://localhost:5173`).

Переопределения через env: `SMOKE_JWT`, `SMOKE_KEEPER_API` (default `http://127.0.0.1:8080`),
`SOUL_STACK_CORE_DIR` (default `../soul-stack`), `KEEPER_DEV_DIR` (default `/tmp/keeper-dev`).

## Карта засева (только СВОИ уникальные данные; чужие строки терпим)

| Спека | Засев (Operator API :8080) |
|-------|----------------------------|
| `login` | — (токен из `token.txt`; негатив — `not.a.jwt`) |
| `souls-list` | 2 pending-души (transport agent/ssh) в уникальном coven |
| `incarnation-create-form` | форма: redis → `create_from_souls` (без provision) → 422 (пустой roster) |
| `all-runs` | — (фид на живых данных: voyages/push/errands) |
| `run-view` | — (проверяем загрузку роута в app-shell) |
| `rerun-last` | redis `create_from_souls` в пустой coven → error_locked |
| `filters-traits-coven` | 2 bare-инкарнации A/B с covens/traits |
| `destroy` | 1 bare-ready hello-world |

Уборка: созданные инкарнации сносятся в teardown (`DELETE ?allow_destroy=true`,
толерантно к 404). Pending-души остаются (DELETE `/v1/souls/{sid}` не поддержан,
405) — имена уникальны, безвредны.

## ⚠️ Безопасность на общем стенде

- Сервис **redis** `create` (с provision) РЕАЛЬНО провиженит облачную VM. Ни спеки,
  ни засев его НЕ используют — только `create_from_souls` (без provision-секции).
- Ассертим только на свои уникальные имена/SID; чужие инкарнации/души не трогаем.

## Отложено до NIM-26 (нужен живой docker-флот душ / connected-души)

- **souls-list**: проекция «reflects connected» (сейчас души pending).
- **run-view / all-runs / rerun-last**: реальный терминальный apply_run инкарнации.
  Без connected-душ redis create против пустого roster = 422 render-assert (не
  персистит прогон), а `create` c provision недопустим на общем стенде. Помечено
  `test.fixme` / runtime-`skip` с причиной. Зелёный success-view — тоже NIM-26.
- **filters-traits-coven / destroy**: если репозиторий сервиса пуст на стенде,
  bare-инкарнации не засеиваются → спека деградирует до structural-проверки
  (filters) или skip с причиной (destroy).

Сам ФЛОУ (навигация, форма, фильтр, диалог) — зелёный; отложены только
ассерты, требующие connected-душ или зелёного прогона.
