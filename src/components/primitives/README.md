# UI primitives

Адаптировано из внутреннего референса `saltgui-design-system`
(`salt-manager/saltgui-design-system/project/preview/components-*.html`).
HTML-превью переведены в TSX + CSS-Modules.

## Соответствие saltgui → Soul Stack

| saltgui-design-system preview         | Soul Stack primitive (этот пакет) | Re-skin                                       |
| ------------------------------------- | --------------------------------- | --------------------------------------------- |
| `components-buttons.html`             | `Button` (`primary/secondary/ghost/danger/iconOnly`) | Без лексики. Подписи задаются caller-ом.      |
| `components-inputs.html`              | `Input`                           | Подписи примеров заменены на нейтральные.     |
| `components-dots.html`                | `Dot` (kinds: `ok/warn/off/info/idle`) | Добавлен `info` (applying), `idle` (pending). |
| `components-cells.html`               | `Cell` (mood: `ok/alert/offline`) | Пример «minions» → передаётся через props.    |
| `components-footer.html`              | `Footer`                          | Бренд "SaltOps" задаётся caller-ом.           |
| (нет prev) — статусные плашки         | `Badge` (tones: `ok/warn/danger/info/muted`) | Новый primitive, согласован с tokens.css.     |

## Re-skin: словарь

В именах compoзитов / props НЕТ:
- `minion` → используем `Soul`
- `grain` → `Soulprint`
- `pillar` → `Essence`
- `state` (как Salt-DSL) → `Destiny`
- `pipeline/job` (как Salt-pipeline) → `apply` / `scenario`
- `cluster` (как Salt-cluster) → `incarnation` (если речь про runtime-инстанс) / `Coven` (если про метку)
- `master` / `minion` (в комментариях) → `Keeper` / `Soul`

Все эти термины используются по `docs/naming-rules.md`.

## Дизайн-токены

`src/styles/tokens.css` — адаптированная версия
`saltgui-design-system/project/colors_and_type.css`:
- Удалены db-brand-цвета (`--db-redis`, `--db-postgres`…) — Soul Stack
  system-agnostic.
- Семантический `--prod` (был кричаще-красным) убран в пользу
  `--danger` + `--info` (для applying/provisioning).
- Keyframes `ds-pulse` переименованы в `ss-pulse` (соглашение Soul Stack).
- Шрифты IBM Plex Sans + JetBrains Mono сохранены (общий стандарт DS).

## Что НЕ переносилось (out-of-pilot)

- `components-jobs.html` — UI «pipeline-jobs» из salt-manager не релевантен
  напрямую (у нас scenario-apply, а не job-pipeline). Будет адресовано
  в отдельном слайсе при реализации `/apply` / `/applies/:id`.
- `components-stats.html`, `components-topbar.html` — заинлайнены
  в layout-компонентах (см. `components/layout/`), не выделяем как
  reusable primitive в pilot.
- `spacing-radii.html`, `type-scale.html`, `colors-*.html` — pure design
  reference, не требуют TSX-обёртки.
