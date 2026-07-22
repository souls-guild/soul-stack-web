# Contributing to Soul Stack Web

Thanks for wanting to help. Soul Stack Web is the operator UI for
[Soul Stack](https://github.com/souls-guild/soul-stack), in **public beta**, and both
**issues** and **pull requests** are open — from humans and from AI coding assistants
alike (see the [AI assistants](README.md#ai-assistants) note in the README).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — open an issue with the "Bug report" template. Include the UI version,
  your browser and OS, reproduction steps, and expected vs. actual behavior. Console
  errors, a failing network request, or a screenshot speed things up a lot.
- **Request a feature** — open an issue with the "Feature request" template and describe
  the problem you're trying to solve, not only the solution you have in mind.
- **Send a pull request** — fixes, UI, docs, and tests are all welcome. For anything
  larger than a small fix, please open an issue first so we can agree on the approach
  before you spend time on it.

Security vulnerabilities are the one exception: **do not** file them as issues or PRs.
Report them privately — see [SECURITY.md](SECURITY.md).

## Contributor License Agreement (CLA)

Before your first pull request can be merged, you'll be asked to sign the
**[Contributor License Agreement](CLA.md)** — once, and it then covers all your future
contributions across Soul Stack.

It's automated: a bot comments on your first PR, and you sign by replying to that comment.
The CLA is a **license-back** agreement — you keep the copyright to your contribution and
grant the project a license to use and relicense it. This is what lets the project honor
the Business Source License (the Additional Use Grant, the Change License, and future
license changes) on behalf of everyone. See [CLA.md](CLA.md) for the full text and the
rationale.

## Development setup

Soul Stack Web is a React 19 + Vite single-page app. To build and check locally:

```sh
git clone https://github.com/souls-guild/soul-stack-web.git
cd soul-stack-web
npm ci --legacy-peer-deps   # the UI pins a few peer ranges
npm run dev                 # vite dev server on http://localhost:5173/ui/
```

The local gate before you push — run all three green:

```sh
npm run lint                # eslint
npm run build               # tsc -b && vite build
npm test                    # vitest run (unit + integration)
```

Some checks are opt-in and worth running when relevant:

- `npm run test:e2e` — Playwright end-to-end smoke tests. Run it if you touched routing,
  auth, or a core flow (the run wizard, RBAC, an entity's detail page).
- `npm run gen:api` — regenerate `src/api/types.gen.ts` after updating the vendored
  OpenAPI spec (see below).

The dev server proxies `/v1`, `/healthz`, `/readyz`, and `/openapi.yaml` to a running
Keeper (`VITE_KEEPER_API`, default `http://localhost:8080`). Bring one up with the core's
[getting-started guide](https://github.com/souls-guild/soul-stack/blob/main/docs/getting-started.md).

### Keeping in sync with the Keeper API

The UI's types come from the Keeper OpenAPI spec, vendored into
`vendor/openapi/keeper.yaml`. When the API changes, refresh the vendored copy and
regenerate:

```sh
cp ../soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml
npm run gen:api
```

The vendored yaml is committed; the generated `src/api/types.gen.ts` is not.

## Conventions

- **Language: English.** All source — code, comments, log/error strings, tests, and docs —
  is in English. The one exception is the i18n product content: the Russian UI translation
  under `public/locales/ru/**` is reader-facing and stays in Russian.
- **Names come from the dictionary.** User-visible UI strings use the Soul Stack vocabulary
  — Keeper, Souls, Coven, Soulprint, Destiny, Essence, Archon, Tide, Errand — never
  borrowed config-management jargon (`master` / `minion` / `grain` / `pillar` / `state.apply`). The
  dictionary lives in the core repo
  ([naming-rules.md](https://github.com/souls-guild/soul-stack/blob/main/docs/naming-rules.md)).
- **The API is the contract.** This UI is a client of the Keeper Operator API; design
  decisions live in the core repo's
  [ADRs](https://github.com/souls-guild/soul-stack/tree/main/docs/adr). Don't show
  `ADR-NNN` in user-visible text — file-level JSDoc is fine.
- **i18n keys go in both locales.** A new user-facing string is added to `en`
  (`src/i18n/locales/en/<ns>.json`) **and** `ru` (`public/locales/ru/<ns>.json`); a
  key-sync test enforces it.
- **Keep comments lean.** Explain the non-obvious *why*, not the obvious *what*.
- **Tests for behavior.** New behavior comes with a test (Vitest + @testing-library, or a
  Playwright e2e for a flow); match locale-dependent text by `data-testid`, not by a
  translated string.

## Before you open a pull request

- `npm run lint`, `npm run build`, and `npm test` are green.
- Commits are focused, with messages that say *why*.
- i18n keys added to both `en` and `ru`; UI vocabulary follows the dictionary.
- The PR description explains the change and how you verified it, with a screenshot for a
  visible UI change. Fill in the
  [pull request template](.github/PULL_REQUEST_TEMPLATE.md).

## Before you open an issue

- Check the core's
  [known-limitations](https://github.com/souls-guild/soul-stack/blob/main/docs/known-limitations.md)
  — some behavior there is deliberately out of scope, not a bug.
- Confirm it reproduces on a fresh build from the current `main`.
