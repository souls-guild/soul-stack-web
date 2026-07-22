# RBAC scope rework — boolean condition builder (proposal)

Status: **draft for the architect/coordinator.** UI mockup: `scope-builder.mockup.html`.
Requires a backend slice + an amendment to **ADR-0047**; per the canon, a new grammar layer = propose-and-wait.

## Decision (product)
- **Keep 5 types:** `coven`, `service`, `incarnation`, `host`, `trait`.
- **Remove entirely:** `regex`, `soulprint`, `state` (pattern matching moves into `host matches <glob>`).
- **Add boolean assembly:** conditions are combined with `AND`/`OR` + grouping (parentheses, nesting).

## Target grammar (sketch)
```
scope      := "*" | expr
expr       := term ( ("AND"|"OR") term )*        // one joiner per group (ALL/ANY)
term       := condition | "(" expr ")"
condition  := coven_c | service_c | incarnation_c | host_c | trait_c
coven_c        := "coven" ("=" v | " in " "(" v ("," v)* ")")
service_c      := "service" ...                  // like coven (exact / in-list)
incarnation_c  := "incarnation" ...              // like coven
host_c         := "host" ("=" v | " in " "(...)" | " matches " glob)   // glob = redis-*
trait_c        := "trait." key "=" v
```
- Within a single key, a list = OR (as today with `coven=a,b`). Between conditions, the group's explicit AND/OR.
- `host matches redis-*` replaces the former `regex='^redis-.*'` (glob instead of RE2; RE2 later if desired — a separate follow-up, but the user asked to drop regex as a type).

## Backend impact (core `keeper/internal/rbac/`)
1. **Parser** `parser.go::parseSelector` — currently strictly one `key=value`; needs an **AST** (an expr/term/condition tree) instead of `map[string][]string`. The bulk of the work.
2. **Matcher** `permission.go::Matches` — already AND-across-keys, but needs tree traversal with AND/OR/parentheses; `trait`/the rest need real context (currently fail-closed).
3. **Purview** `purview.go::ResolvePurview` — today it collects dimensions as a union; boolean logic within a single permission changes the semantics of the dimensions.
4. **★ Least-privilege `subset.go`** (ADR-0047 §gotcha) — "permission ⊆ my own scope" over a **boolean expression**. This is the **key security risk** and the main reason for the architectural gate: containment of boolean predicates ≠ string comparison. Without a correct extension, privilege escalation follows.
5. **Catalog** `catalog.go::allowedSelectorKeys` — drop `regex/soulprint/state`; removing types needs **migration/deprecation** of permissions where they're already used.
6. **openapi** `keeper.yaml` + web `types.gen.ts` — the scope shape in the response/request (string vs structured AST).

## UI (owned by frontend, once the grammar is agreed)
- Replace the current `key=value` ScopePicker with a **condition-builder** (mockup): ALL(AND)/ANY(OR) groups, nested groups, `key · op · value` rows with type-specialized input (coven/service/incarnation — chips/list; host — exact/in/matches glob; trait — `key=value`), live rule preview.
- Client-side validation for the new grammar (rewrite the `schemas.ts` PERMISSION regex for the AST/string).
- i18n for both locales.

## Open questions for the architect
1. Wire format: a **string** (`… on <expr>`) vs a **structured AST** in JSON? (affects openapi and subset).
2. `subset.go`: acceptable containment scope (full boolean subsumption vs the conservative "grantor must be Unrestricted or an exact expression match")?
3. Fate of existing permissions with `regex/soulprint/state` when the types are removed (migration/deprecation grace).
4. `host matches` — glob-only, or keep RE2 under the hood too?
