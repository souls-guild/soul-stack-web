# UI-smoke (Playwright)

Smoke UI tests against a **live local stand** of Soul Stack (no API mocks).
They exercise real navigation/forms/filters/dialogs through the Keeper Operator API.

This is a **separate UI plane**, orthogonal to the backend ladder L0–L3c: the name is flat
("ui-smoke"), not an entity metaphor (ADR-039 — no new vocabulary entity).

## Prerequisite: bring up the stand

The tests do NOT start Keeper. Bring up the stand from the core repo:

```bash
cd ../soul-stack
make dev-provision   # PG + Vault + Redis + seed services (hello-world, redis)
make dev-keeper      # Keeper Operator API on :8080
make dev-web         # (or npm run dev here) vite on :5173
```

Check: `GET http://127.0.0.1:8080/healthz` → 200, UI at http://localhost:5173/ui/.

## Running

```bash
npm run test:e2e        # headless run of all specs
npm run test:e2e:ui     # interactive Playwright UI
```

`globalSetup` (`e2e/global-setup.ts`):
1. Checks `GET :8080/healthz` == 200 (otherwise — a clear error with instructions).
2. Mints an Archon JWT: `SMOKE_JWT` (env) → `make -C <core> dev-jwt` (with `VAULT_TOKEN=root`,
   since the operator env usually carries a prod token) → fallback `/tmp/keeper-dev/archon-dev.jwt`.
3. Writes `e2e/.auth/token.txt` (for API seeding) and `e2e/.auth/state.json`
   (storageState: localStorage `soul-stack.jwt` for origin `http://localhost:5173`).

Env overrides: `SMOKE_JWT`, `SMOKE_KEEPER_API` (default `http://127.0.0.1:8080`),
`SOUL_STACK_CORE_DIR` (default `../soul-stack`), `KEEPER_DEV_DIR` (default `/tmp/keeper-dev`).

## Seed map (only OUR OWN unique data; foreign rows are tolerated)

| Spec | Seed (Operator API :8080) |
|------|---------------------------|
| `login` | — (token from `token.txt`; negative — `not.a.jwt`) |
| `souls-list` | 2 pending souls (transport agent/ssh) in a unique coven |
| `incarnation-create-form` | form: redis → `create_from_souls` (no provision) → 422 (empty roster) |
| `all-runs` | — (feed on live data: voyages/push/errands) |
| `run-view` | — (verify the route loads in the app-shell) |
| `rerun-last` | redis `create_from_souls` into an empty coven → error_locked |
| `filters-traits-coven` | 2 bare incarnations A/B with covens/traits |
| `destroy` | 1 bare-ready hello-world |

Cleanup: created incarnations are torn down in teardown (`DELETE ?allow_destroy=true`,
tolerant of 404). Pending souls remain (DELETE `/v1/souls/{sid}` is not supported,
405) — names are unique and harmless.

## ⚠️ Safety on a shared stand

- The **redis** service `create` (with provision) REALLY provisions a cloud VM. Neither the
  specs nor the seed use it — only `create_from_souls` (without a provision section).
- Assert only on our own unique names/SIDs; we do not touch foreign incarnations/souls.

## Deferred until NIM-26 (needs live souls running in docker / connected souls)

- **souls-list**: the "reflects connected" projection (souls are currently pending).
- **run-view / all-runs / rerun-last**: a real terminal incarnation apply_run.
  Without connected souls, redis create against an empty roster = 422 render-assert (does not
  persist a run), and `create` with provision is not allowed on a shared stand. Marked
  `test.fixme` / runtime `skip` with a reason. A green success view is also NIM-26.
- **filters-traits-coven / destroy**: if the service repo is empty on the stand,
  bare incarnations are not seeded → the spec degrades to a structural check
  (filters) or skips with a reason (destroy).

The FLOW itself (navigation, form, filter, dialog) is green; only the
assertions requiring connected souls or a green run are deferred.
