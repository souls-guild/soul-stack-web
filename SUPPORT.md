# Support

Soul Stack Web is the operator UI for [Soul Stack](https://github.com/souls-guild/soul-stack),
in **public beta**. This document explains where to go with questions and issues.

## Support level

**Best-effort, no SLA.** We respond as we're able; there's no guaranteed response time
during the beta. The goal of the beta is to gather feedback and catch bugs before the
stable release, not to provide production support.

## Where to go

| What you have                                | Where                                                                 |
|-----------------------------------------------|------------------------------------------------------------------------|
| Bug, broken UI, unexpected behavior           | **GitHub Issues** in this repository ("Bug report" template)          |
| Idea / feature request                        | **GitHub Issues** ("Feature request" template)                        |
| Question, "how do I…", design discussion      | **GitHub Discussions** in this repository                             |
| Quick question, discussion, community chat    | **Discord** — https://discord.gg/cMwMW2UTyE                           |
| Security vulnerability                        | **GitHub Security Advisory** — see [SECURITY.md](SECURITY.md). NOT a public issue. |

Real-time community chat is on our [Discord](https://discord.gg/cMwMW2UTyE).

The UI is a client of the Keeper Operator API — if the problem is in the backend behavior
rather than the UI, the [core repository](https://github.com/souls-guild/soul-stack) is the
right place.

## Commercial support and services

Soul Stack ships complete: the web UI, LDAP/OIDC login, RBAC, audit trail, OpenAPI, the MCP
server, and automatic certificate rotation are all part of the open-source core. What we
offer commercially is help, not features — our time to get you to production faster and
shape Soul Stack around your environment:

- **Priority feature work** — need a page, module, or capability ahead of the community
  roadmap? We can build it and upstream it.
- **Integration help** — wiring Soul Stack into what you already run: your Vault, your
  identity provider, your CI, and your existing fleet.
- **Consulting and rollout** — architecture review, migration from your current
  configuration-management tooling, and hands-on help bringing your first fleet live.

Reach out through [soul-stack.com](https://soul-stack.com) or email
[licensing@soul-stack.com](mailto:licensing@soul-stack.com).

## Before filing an issue

- Note the UI version (release or commit) and whether it reproduces on the current
  `v0.1.0-beta.x`.
- Include your browser and OS, reproduction steps, and console/network output or a
  screenshot.
- **Do not paste secrets** (JWT tokens — the UI stores one in `localStorage` — Vault
  contents, private keys, DSNs with passwords). Mask anything sensitive.

## Where to start

- [README.md](README.md) — what this is, the stack, and the dev quickstart.
- [soul-stack.com](https://soul-stack.com) — project site and online documentation.
- [Getting started](https://github.com/souls-guild/soul-stack/blob/main/docs/getting-started.md)
  (core) — bring up a Keeper for the UI to talk to.
