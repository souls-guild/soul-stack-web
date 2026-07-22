# Security Policy

Soul Stack Web is the operator console for a Soul Stack Keeper cluster. It handles operator
credentials (the JWT used against the Keeper Operator API) and is the surface operators act
on the fleet from, so we treat vulnerabilities as high priority. Thank you for reporting
responsibly.

## Supported versions

The project is in **public beta**. Only the current beta line receives security fixes:

| Version           | Supported        |
|-------------------|------------------|
| `v0.1.0-beta.x`   | yes (current)    |
| anything older    | no               |

There is no stable release yet. Security fixes ship in the next beta release; we do not
backport to earlier beta builds.

## How to report a vulnerability

**Do not open a public issue, and do not describe the vulnerability in a pull request.**
Use a private channel:

1. **GitHub private advisory (preferred).** In the repository, go to the **Security** tab →
   **Advisories** → **Report a vulnerability**. The thread is visible only to you and the
   maintainers, and it keeps everything in one place.
2. **Email.** If you can't use GitHub advisories, write to **security@soul-stack.com**. If
   you want to send encrypted details, say so in a first plaintext message and we'll
   arrange a key.

Either way, please don't disclose the issue publicly until a fix has shipped.

### What to include

The more specific the report, the faster we can reproduce it:

- Affected area (auth / a specific page or flow / API client) and the UI version or commit.
- Browser and OS.
- Reproduction steps or a PoC — as minimal as possible.
- Impact assessment: what the attacker gains (JWT/token leakage, XSS, CSRF, RBAC bypass in
  the UI, leaking data across operators, …).
- Relevant console errors, a network trace, or a screenshot.

**Do not attach real secrets** — JWT tokens, Vault contents, SoulSeed private keys, or DSNs
with passwords. The UI stores the operator JWT in `localStorage`; mask anything sensitive
before submitting.

## Timeline expectations

Beta support is **best-effort, no SLA**. We respond as capacity allows; there is no
guaranteed response or fix time during the beta. For accepted advisories we keep you updated
through the same private thread, and we'll credit you in the advisory once a fix is out
(unless you prefer to stay anonymous).

## Threat model

The web UI is part of the operator surface of a Keeper cluster; the recorded assets,
actors, surfaces, and residual risks of the cluster live in the core repo's
[threat model](https://github.com/souls-guild/soul-stack/blob/main/docs/security/threat-model.md).
Any discrepancy between that model and actual behavior is treated as a security bug — report
it through a private advisory, not as a regular issue.
