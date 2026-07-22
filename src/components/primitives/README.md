# UI primitives

Reusable presentational components for the Soul Stack UI — one `.tsx` +
`.module.css` per component, driven by the design tokens in `src/styles/tokens.css`.

## Components

| Primitive | Variants | Notes |
| --- | --- | --- |
| `Button` | `primary/secondary/ghost/danger/iconOnly` | No vocabulary; labels are set by the caller. |
| `Input` | — | Text input with neutral example labels. |
| `Dot` | `ok/warn/off/info/idle` | Status dot; `info` = applying, `idle` = pending. |
| `Cell` | mood `ok/alert/offline` | List/table cell; content passed via props. |
| `Footer` | — | Footer bar; brand text is set by the caller. |
| `Badge` | tones `ok/warn/danger/info/muted` | Status chip, aligned with `tokens.css`. |

## Vocabulary

Composite and prop names use the Soul Stack dictionary, never SaltStack terms:

- `minion` → `Soul`
- `grain` → `Soulprint`
- `pillar` → `Essence`
- `state` (as Salt-DSL) → `Destiny`
- `pipeline/job` (as Salt-pipeline) → `apply` / `scenario`
- `cluster` (as Salt-cluster) → `incarnation` (runtime instance) / `Coven` (label)
- `master` / `minion` (in comments) → `Keeper` / `Soul`

All terms follow `docs/naming-rules.md`.

## Design tokens

`src/styles/tokens.css` holds the CSS custom properties (light/dark), the IBM Plex
Sans + JetBrains Mono fonts, and the semantic colours. It is system-agnostic — no
product- or db-specific brand colours. Errors use `--danger`; applying/provisioning
uses `--info`; the pulse animation uses the `ss-pulse` keyframes.
