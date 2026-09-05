# Soul Stack Web

**English** · [Русский](docs/i18n/README.ru.md)

The **operator web console** for
[Soul Stack](https://github.com/souls-guild/soul-stack) — a single-page app over the
Keeper Operator API. Soul Stack's core is a Keeper cluster that brings a fleet of `soul`
agents to their declared **Destiny**; this repository is the web UI an operator drives it
from — services and incarnations, Souls and Soulprints, the run wizard, RBAC, audit — the
whole console, not a thin status page.

[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1%20%E2%86%92%20Apache%202.0-blue)](LICENSE)
[![Status: public beta](https://img.shields.io/badge/status-public%20beta-orange)](https://github.com/souls-guild/soul-stack/blob/main/docs/known-limitations.md)

> **Public beta.** No stability or SLA guarantees yet. The Keeper API this UI targets —
> its schemas, endpoints, and on-the-wire shapes — may change between beta releases, and
> the UI moves with it. What's **not** in scope for the beta —
> [known limitations](https://github.com/souls-guild/soul-stack/blob/main/docs/known-limitations.md).

## A separate artifact, on purpose

The web UI ships as its own repository and build, not embedded in the `keeper` binary —
the same split as **OpenStack ↔ Horizon** and **Kubernetes ↔ Dashboard**: a dedicated
operator UI over a core API/CLI
([ADR-035](https://github.com/souls-guild/soul-stack/blob/main/docs/architecture.md)). The
API is the contract; this UI is one client of it.

## What's inside

A full operator console for a Keeper cluster:

- **Run wizard** — the primary entry point for every work run (scenario + Tide /
  multi-target Errand / push), with typed input from the scenario's `input_schema`.
- **Registry** — Services, Incarnations, Souls (with typed Soulprint), Plugins.
- **Identity & access** — Archons (operators), RBAC roles and permissions, token issue /
  revoke.
- **Runs & history** — Tides, Errand runs, and push runs, with live progress and per-host
  detail.
- **Audit** — the operator audit log with filters.
- **i18n** — English by default, Russian bundled; the UI ships bilingual.

## Stack

- **React 19** + **TypeScript** + **Vite**
- **React Router 7**
- **TanStack Query** (server state)
- **React Hook Form** + **Zod** (forms and validation)
- **lucide-react** (icons)
- **Vitest** + **@testing-library/react** (unit / integration), **Playwright** (e2e)
- **ESLint** flat config

## Quickstart

```sh
npm ci --legacy-peer-deps   # install (the UI pins a few peer ranges)
npm run dev                 # vite dev server on http://localhost:5173/ui/
npm run build               # production build in dist/
npm run lint                # eslint
npm test                    # vitest run
```

`npm run dev` proxies `/v1`, `/healthz`, `/readyz`, and `/openapi.yaml` to a running
Keeper (default `http://localhost:8080`). Point it elsewhere with:

```sh
VITE_KEEPER_API=http://keeper.internal:8080 npm run dev
```

Bring up a Keeper to talk to with the core's
[getting-started guide](https://github.com/souls-guild/soul-stack/blob/main/docs/getting-started.md).

## Staying in sync with core

The UI's TypeScript types are generated from the Keeper OpenAPI spec, vendored into
`vendor/openapi/keeper.yaml` (a copy of the core repo's `docs/keeper/openapi.yaml`). When
the API changes, refresh it:

```sh
cp ../soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml
npm run gen:api             # openapi-typescript → src/api/types.gen.ts
```

The vendored yaml is committed; the generated `src/api/types.gen.ts` is not.

## AI assistants

PRs from AI coding assistants are welcome — but AI can be wrong, and whatever tool wrote a
change, **you** are responsible for checking it before you send it. Re-read and run the
change (a green `npm run lint` / `npm run build` / `npm test` and a clear description of
*why* it's correct go a long way), and respect the design process — the API contract and
the naming dictionary live in the core repo. The same rules apply to humans and assistants
alike; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Issues and pull requests are open. Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it
covers the dev setup, the lint / build / test gate, the Contributor License Agreement
(signed once, on your first PR), and the coding conventions. By participating you agree to
the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security and support

- **Security vulnerabilities** — report privately, **not** as a public issue:
  [SECURITY.md](SECURITY.md) (`security@soul-stack.com` or a GitHub private advisory).
- **Bugs and unexpected behavior** —
  [GitHub Issues](https://github.com/souls-guild/soul-stack-web/issues) ("Bug report"
  template). Include your browser, the UI version, and any console output.
- **Questions and where to reach out** — [SUPPORT.md](SUPPORT.md). Beta support is
  best-effort, no SLA.

## License

Soul Stack Web is **[Business Source License 1.1](LICENSE)** (fair-code) — the same
license as the Soul Stack core: the source is open, and **production use is granted for
internal use** (running it to manage your own or your organization's infrastructure,
including commercially). Other production use — offering it to third parties as a hosted or
managed service, white-labeling, or embedding it — requires a commercial license. Each
version automatically becomes
**[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)** two years after its release
(the Change Date), so the restriction is temporary, not permanent. The Soul Stack SDK and
plugins are Apache 2.0.

Plain-language explanation of what you can and can't do — [LICENSING.md](LICENSING.md). The
"Soul Stack" name and logo are covered by [trademark](TRADEMARK.md), separately from the
code license.

## Links

- **Website:** https://soul-stack.com (overview, guides, hosted docs)
- **Core repository:** https://github.com/souls-guild/soul-stack (Keeper / Souls / API)
