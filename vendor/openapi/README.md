# Vendored OpenAPI

Sync from core-repo: github.com/souls-guild/soul-stack (2026-05-29).
Manual sync via cp; future — published artifact (ADR-035, deferred).

To update — `cp <core-repo>/keeper/internal/api/meta/openapi.yaml vendor/openapi/keeper.yaml && npm run gen:api`.

## Iteration 3 (2026-05-26): API gaps round 2 closed

From commit `157ee27` (core):

- `GET /v1/audit` — paged audit-events with filters (multi-value type/source,
  archon_aid, correlation_id, started_after/before).
- `GET /v1/operators` — list Archons (filters auth_method, revoked,
  pagination).
- `GET /v1/operators/{aid}` — Archon detail.
- `?module=` multi-value filter for `GET /v1/errands`
  (style: form, explode: true — exact-match OR).

UI iteration 3 closes the `/audit`, `/archons`, `/archons/:aid` placeholders and
moves the ErrandHistory module filter to server-side.

## Iteration 2 (2026-05-26): new endpoints

From commit `36c719d` (Errand E4 and preceding):

- `POST /v1/souls/{sid}/exec` — Errand exec (sync 200 / async 202).
- `GET /v1/errands`, `GET /v1/errands/{errand_id}` — Errand history + poll.
- `POST /v1/push/apply`, `GET /v1/push/{apply_id}` — push-apply async-flow.
- `POST /v1/operators`, `POST /v1/operators/{aid}/revoke`,
  `POST /v1/operators/{aid}/issue-token` — Archon admin (create/revoke/reissue).

## Iteration 4 (2026-05-29): permissions catalog + new AID format

From core keeper/internal/api/meta/openapi.yaml (2026-05-29):

- `GET /v1/permissions` — RBAC permissions catalog (ADR-042); the
  `PermissionAction`/`PermissionCatalogItem`/`PermissionCatalogReply` schemas are now
  in codegen (manual types in keeper.ts replaced with `components['schemas'][...]`).
- Operator AID pattern updated: `^[a-z0-9][a-z0-9._@-]{1,127}$`
  (instead of `^archon-[a-z0-9-]{1,62}$`).

## Known gaps

Current status — sync clean.
