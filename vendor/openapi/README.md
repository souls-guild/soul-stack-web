# Vendored OpenAPI

Sync from core-repo: github.com/co-cy/soul-stack (commit `157ee27`, 2026-05-26).
Manual sync via cp; future — published artifact (ADR-035 отложенное).

При update — `cp core-repo/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml && npm run gen:api`.

## Iteration 3 (2026-05-26): API gaps round 2 закрыты

Из commit `157ee27` (core):

- `GET /v1/audit` — paged audit-events с фильтрами (multi-value type/source,
  archon_aid, correlation_id, started_after/before).
- `GET /v1/operators` — list Архонтов (фильтры auth_method, revoked,
  пагинация).
- `GET /v1/operators/{aid}` — detail Архонта.
- `?module=` multi-value фильтр для `GET /v1/errands`
  (style: form, explode: true — exact-match OR).

UI iteration 3 закрывает placeholder-ы `/audit`, `/archons`, `/archons/:aid` и
переводит ErrandHistory module-фильтр на server-side.

## Iteration 2 (2026-05-26): новые endpoint-ы

Из commit `36c719d` (Errand E4 и предшествующие):

- `POST /v1/souls/{sid}/exec` — Errand exec (sync 200 / async 202).
- `GET /v1/errands`, `GET /v1/errands/{errand_id}` — Errand history + poll.
- `POST /v1/push/apply`, `GET /v1/push/{apply_id}` — push-apply async-flow.
- `POST /v1/operators`, `POST /v1/operators/{aid}/revoke`,
  `POST /v1/operators/{aid}/issue-token` — Archon admin (create/revoke/reissue).

## Known gaps

Все gap-ы iteration 1/2 закрыты в iteration 3 (commit core `157ee27`).
Текущий status — sync clean.
