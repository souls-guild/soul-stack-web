# Vendored OpenAPI

Sync from core-repo: github.com/co-cy/soul-stack (commit `36c719d`, 2026-05-26).
Manual sync via cp; future — published artifact (ADR-035 отложенное).

При update — `cp core-repo/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml && npm run gen:api`.

## Iteration 2 (2026-05-26): новые endpoint-ы

Из commit `36c719d` Errand E4 и предшествующих:

- `POST /v1/souls/{sid}/exec` — Errand exec (sync 200 / async 202).
- `GET /v1/errands`, `GET /v1/errands/{errand_id}` — Errand history + poll.
- `POST /v1/push/apply`, `GET /v1/push/{apply_id}` — push-apply async-flow.
- `POST /v1/operators`, `POST /v1/operators/{aid}/revoke`,
  `POST /v1/operators/{aid}/issue-token` — Archon admin (create/revoke/reissue).

## Known gaps

- **Нет `GET /v1/operators` (list)** — endpoint не выставлен в OpenAPI. UI
  `/archons` рендерит форму create-нового и форму revoke/issue-token по AID;
  таблицы существующих архонтов нет (нечего читать).
- **Нет `GET /v1/audit` или эквивалента** — audit-trail в OpenAPI не выставлен.
  UI `/audit` рендерит placeholder с TODO.
