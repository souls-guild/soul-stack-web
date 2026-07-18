# RBAC scope rework — boolean condition builder (proposal)

Статус: **черновик для архитектора/координатора.** UI-мокап: `scope-builder.mockup.html`.
Требует backend-слайса + амендмента **ADR-0047**; по канону новый грамматический слой = propose-and-wait.

## Решение (продукт)
- **Оставить 5 типов:** `coven`, `service`, `incarnation`, `host`, `trait`.
- **Удалить целиком:** `regex`, `soulprint`, `state` (паттерн-матчинг переносится в `host matches <glob>`).
- **Добавить булеву сборку:** условия объединяются `AND`/`OR` + группировка (скобки, вложенность).

## Целевая грамматика (эскиз)
```
scope      := "*" | expr
expr       := term ( ("AND"|"OR") term )*        // в группе один joiner (ALL/ANY)
term       := condition | "(" expr ")"
condition  := coven_c | service_c | incarnation_c | host_c | trait_c
coven_c        := "coven" ("=" v | " in " "(" v ("," v)* ")")
service_c      := "service" ...                  // как coven (exact / in-list)
incarnation_c  := "incarnation" ...              // как coven
host_c         := "host" ("=" v | " in " "(...)" | " matches " glob)   // glob = redis-*
trait_c        := "trait." key "=" v
```
- Внутри одного ключа список = OR (как сегодня `coven=a,b`). Между условиями — явный AND/OR группы.
- `host matches redis-*` заменяет прежний `regex='^redis-.*'` (glob вместо RE2; RE2 при желании — отдельным follow-up, но пользователь просил убрать regex как тип).

## Влияние на backend (core `keeper/internal/rbac/`)
1. **Парсер** `parser.go::parseSelector` — сейчас строго один `key=value`; нужен **AST** (дерево expr/term/condition) вместо `map[string][]string`. Главный объём.
2. **Матчер** `permission.go::Matches` — уже AND-по-ключам, но нужен обход дерева с AND/OR/скобками; `trait`/остальные — реальный контекст (сейчас fail-closed).
3. **Purview** `purview.go::ResolvePurview` — сегодня собирает измерения как union; булева логика внутри одного права меняет семантику измерений.
4. **★ Least-privilege `subset.go`** (ADR-0047 §gotcha) — «право ⊆ мой собственный scope» над **булевым выражением**. Это **ключевой риск безопасности** и главная причина архитектурного гейта: containment булевых предикатов ≠ сравнение строк. Без корректного расширения — эскалация привилегий.
5. **Каталог** `catalog.go::allowedSelectorKeys` — убрать `regex/soulprint/state`; при удалении типов нужна **миграция/деприкация** прав, где они уже использованы.
6. **openapi** `keeper.yaml` + web `types.gen.ts` — форма scope в ответе/запросе (строка vs структурированный AST).

## UI (в ведении фронта, после согласования грамматики)
- Заменить нынешний `key=value` ScopePicker на **condition-builder** (мокап): группы ALL(AND)/ANY(OR), вложенные группы, строки `key · op · value` с type-specialized вводом (coven/service/incarnation — чипы/список; host — exact/in/matches glob; trait — `key=value`), живой предпросмотр правила.
- Клиентская валидация под новую грамматику (`schemas.ts` PERMISSION regex переписать под AST/строку).
- i18n обе локали.

## Открытые вопросы к архитектору
1. Формат на проводе: **строка** (`… on <expr>`) vs **структурированный AST** в JSON? (влияет на openapi и subset).
2. `subset.go`: допустимый объём containment (полный булев subsumption vs консервативное «grantor must be Unrestricted или точное совпадение выражения»)?
3. Судьба существующих прав с `regex/soulprint/state` при удалении типов (миграция/деприкация-грейс).
4. `host matches` — glob-only или оставить и RE2 под капотом?
