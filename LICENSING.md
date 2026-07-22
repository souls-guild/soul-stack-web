# Soul Stack Web Licensing

A human-readable explanation of the license for `soul-stack-web` — the operator
web interface (soul-stack-ui) to the Soul Stack Keeper API. The [`LICENSE`](LICENSE)
file text is the legally binding one; this document explains its practical meaning.

> **Draft edition.** Wording is being finalized with legal counsel.
> Full decision and rationale — [ADR-016](https://github.com/souls-guild/soul-stack/blob/main/docs/adr/0016-parity-license.md)
> (lives in the core `soul-stack` repository).

The web UI is distributed under the **same license as the core** of Soul Stack —
it is an operator interface on top of the Keeper API, not a standalone product.

Soul Stack is **fair-code**: the source is open and available, and you may run it in
production to operate your own infrastructure — but providing it to third parties as
a service or product is reserved for a commercial license.

## Summary

| Component | License | Meaning |
|---|---|---|
| **Web interface** — `soul-stack-web` / soul-stack-ui (**this repository**) | **BSL 1.1** (fair-code) → after 2 years each version becomes **Apache 2.0** | same as the core: source is open; production use is granted for **Internal Use** (running it to manage your own or your organization's infrastructure, including commercial internal operations); any other production use needs a separate commercial license |
| **Core** — Keeper, Soul, soulctl, soul-lint, built-in `core.*` modules (core repository [`soul-stack`](https://github.com/souls-guild/soul-stack)) | **BSL 1.1** → Apache 2.0 | source is open; production use is granted for Internal Use; any other production use needs a separate commercial license |
| **SDK, examples, plugins** (`sdk/*`, `examples/`, official/community `soul-mod-*`) | **Apache 2.0** | fully free, including proprietary third-party plugins |
| **Premium packs, enterprise modules** (later) | commercial | optional future separate products; the shipped core is all-included |

## What BSL is and why not "fully open source"

**BSL (Business Source License) 1.1** is the same model used by MariaDB, Sentry,
CockroachDB, HashiCorp, and n8n. The source is open: it can be read, built,
modified, and run in production for your own **Internal Use** — with one boundary:
providing Soul Stack (including its web UI) to third parties, or operating it for
someone else's infrastructure, is reserved for a commercial license. After
**2 years**, each specific version automatically becomes **Apache 2.0** — fully open
software. It is a sliding window: today's version becomes Apache in two years, the
next one two years after its own release.

Why fair-code, and not full closure or plain Apache:

- **Trust requires openness.** Soul Stack installs an agent and handles secrets on
  your servers — the source (including the UI the operator manages the fleet
  through) must be available for audit.
- **Project sustainability.** An open codebase with no resale protection is easily
  turned into someone else's paid service with no contribution back. BSL closes
  exactly that scenario while leaving everything else open.
- **Return to the commons.** The Change Date guarantees that each version
  eventually becomes Apache 2.0 — the restriction is temporary, not permanent.

## What I'm allowed to do (Additional Use Grant)

The grant, in the words of the [`LICENSE`](LICENSE):

> You may make production use of the Licensed Work solely for Internal Use —
> operating the Licensed Work to manage your own or your organization's
> infrastructure, including for commercial internal operations. Any other
> production use is not granted here and requires a separate commercial license
> from the Licensor. This includes, without limitation, making the Licensed Work
> (or a modified version of it) available to third parties — whether for a fee or
> free of charge, and whether under its own name, your name, or a different brand
> (white-labeling) — as a hosted or managed service or as a product, and embedding
> the Licensed Work into a third-party product (OEM).

**Permitted without a separate license:**

- **Internal use** — running the web UI to manage your own or your organization's
  infrastructure, including in commercial internal operations.
- **Development, testing, evaluation, demos.**

**Requires a separate commercial license:**

- **Operating Soul Stack for someone else's infrastructure** — professional or
  managed services where you run Soul Stack (or its web UI) to operate a client's
  infrastructure, whether the client logs in or only receives the result. This is
  production use beyond your own Internal Use.
- **Hosted / managed service for third parties** — making Soul Stack (or a
  modification of it, including the web UI) available to third parties as a service
  or product, whether for a fee or free of charge.
- **White-label** — providing Soul Stack under your name or a different brand.
- **Embedding / OEM** — embedding Soul Stack into a third-party product.

For a commercial license, contact `licensing@soul-stack.com`.

### The boundary for managed providers (MSP)

Internal Use is strictly *your own or your organization's* infrastructure. Serving
someone else changes the picture:

1. **The client self-hosts and operates Soul Stack themselves** for their own
   infrastructure — that is the client's own Internal Use, under their own copy of
   the license. You may help them set it up, but they are the ones operating it.
2. **You operate Soul Stack to manage the client's infrastructure** — the client
   only receives the result and never logs in. This is production use beyond your
   own Internal Use → **a commercial license is required.**
3. **The client logs in to the web UI and uses Soul Stack** as a service or product
   → **a commercial license is required.**

## Why the SDK and plugins are Apache 2.0

The ecosystem must grow without friction. Plugins are separate processes talking
to the core over gRPC, and are legally not a derivative work of the core.
Therefore **the SDK, examples, and plugins are under Apache 2.0**: authors are
free to publish their modules under any license, including proprietary paid
plugins. The BSL boundary covers only running the core itself (and the web UI)
beyond your Internal Use, not writing extensions for it.

## Brand and "official"

The name, logo, and the "official" / "certified" / "official managed" statuses are
protected by **trademark**, not by the code license. Allowed: self-hosting,
training, plugin development, mentioning compatibility. Not allowed: calling a fork
"Soul Stack", selling "certification" or "official managed" in our name.

## Contributing code (CLA)

A Contributor License Agreement is put in place before the first external
contributor — under fair-code it is needed to hold the right to the Additional Use
Grant, the Change License, and future license amendments. The CLA is shared across
the whole Soul Stack project; see
[CONTRIBUTING.md in the core repository](https://github.com/souls-guild/soul-stack/blob/main/CONTRIBUTING.md).

## FAQ

**Can a commercial company use the web UI for free?**
Yes — for **Internal Use**: managing its own or its organization's infrastructure,
including commercial internal operations. Any use beyond that (serving third
parties, a hosted service, white-label, OEM) needs a commercial license.

**I'm an MSP — can I serve clients through this web UI?**
Not under the free grant. Operating Soul Stack to manage a client's infrastructure
— whether the client logs in or only receives the result — is production use beyond
your own Internal Use and needs a commercial license (`licensing@soul-stack.com`).
A client who self-hosts and operates their own copy for their own infrastructure is
doing their own Internal Use.

**What exactly becomes Apache 2.0, and when?**
Each specific version of the core and the web UI — 2 years after its first public
release. The restriction lifts automatically, retroactively for that version.

**Does my plugin have to be open?**
No. The SDK and plugins are Apache 2.0; you publish your plugin under any license,
including proprietary and paid.

---

Full decision and rationale — [ADR-016](https://github.com/souls-guild/soul-stack/blob/main/docs/adr/0016-parity-license.md)
(core repository). Legal text — [`LICENSE`](LICENSE).
