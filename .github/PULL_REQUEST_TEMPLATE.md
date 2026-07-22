<!-- Thanks for contributing! Please read CONTRIBUTING.md first. On your first PR a bot
     will ask you to sign the CLA (CLA.md) — reply to its comment to sign. -->

## What changed

<brief description of the PR: why, what exactly is changing, key files touched>

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] Feature (non-breaking)
- [ ] Breaking change (removes/renames a route, changes stored auth/state shape, drops backward-compat)
- [ ] Documentation only
- [ ] Refactor (no behavior change)

## Local checks

- [ ] `npm run lint` green
- [ ] `npm run build` green
- [ ] `npm test` green
- [ ] `npm run test:e2e` green (if routing / auth / a core flow touched)

## UI / API

- [ ] No user-visible strings changed — skip the i18n line below.
- [ ] i18n keys added to **both** `en` (`src/i18n/locales/en/`) and `ru` (`public/locales/ru/`).
- [ ] Uses the Soul Stack dictionary (no `master` / `minion` / `grain` / `pillar`); no `ADR-NNN` in user-visible text.
- [ ] OpenAPI types regenerated (`npm run gen:api`) if `vendor/openapi/keeper.yaml` changed.

## Contributor checklist

- [ ] I've read [CONTRIBUTING.md](https://github.com/souls-guild/soul-stack-web/blob/main/CONTRIBUTING.md).
- [ ] I'll sign the [CLA](https://github.com/souls-guild/soul-stack-web/blob/main/CLA.md) when the bot asks (first PR only).
- [ ] This is not a security report (those go through [SECURITY.md](https://github.com/souls-guild/soul-stack-web/blob/main/SECURITY.md), not a PR).

## Screenshots

<before / after for any visible UI change>

## Other

<command output, links to issues, notes for the reviewer>
