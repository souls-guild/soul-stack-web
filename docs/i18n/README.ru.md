# Soul Stack Web

[English](../../README.md) · **Русский**

**Операторская web-консоль** для
[Soul Stack](https://github.com/souls-guild/soul-stack) — SPA поверх Keeper Operator API.
Ядро Soul Stack — это кластер Keeper, который приводит парк агентов `soul` к их
объявленной **Destiny**; этот репозиторий — web-UI, из которого оператор им управляет:
сервисы и incarnation, Souls и Soulprint, run-визард, RBAC, аудит — полноценная консоль, а
не тонкая страница статуса.

[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1%20%E2%86%92%20Apache%202.0-blue)](../../LICENSE)
[![Status: public beta](https://img.shields.io/badge/status-public%20beta-orange)](https://github.com/souls-guild/soul-stack/blob/main/docs/known-limitations.md)

> **Публичная бета.** Гарантий стабильности и SLA пока нет. Keeper API, на который
> нацелен этот UI — его схемы, эндпоинты и форматы на проводе — может меняться между
> бета-релизами, и UI меняется вместе с ним. Что **не входит** в бету —
> [known limitations](https://github.com/souls-guild/soul-stack/blob/main/docs/known-limitations.md).

## Отдельный артефакт — намеренно

Web-UI поставляется отдельным репозиторием и сборкой, а не встроен в бинарь `keeper` — тот
же раздел, что **OpenStack ↔ Horizon** и **Kubernetes ↔ Dashboard**: выделенный
операторский UI поверх core API/CLI
([ADR-035](https://github.com/souls-guild/soul-stack/blob/main/docs/architecture.md)). API
— это контракт; этот UI — один из его клиентов.

## Что внутри

Полноценная операторская консоль для кластера Keeper:

- **Run-визард** — основная точка входа для любого прогона (scenario + Tide /
  multi-target Errand / push), с типизированным вводом из `input_schema` сценария.
- **Реестр** — Services, Incarnations, Souls (с типизированным Soulprint), Providers,
  Plugins.
- **Identity и доступ** — Archons (операторы), RBAC-роли и права, выпуск / отзыв токенов.
- **Прогоны и история** — Tides, Errand runs и push runs с живым прогрессом и разбивкой
  по хостам.
- **Аудит** — операторский журнал аудита с фильтрами.
- **i18n** — English по умолчанию, Russian в комплекте; UI поставляется двуязычным.

## Стек

- **React 19** + **TypeScript** + **Vite**
- **React Router 7**
- **TanStack Query** (серверное состояние)
- **React Hook Form** + **Zod** (формы и валидация)
- **lucide-react** (иконки)
- **Vitest** + **@testing-library/react** (unit / integration), **Playwright** (e2e)
- **ESLint** flat config

## Быстрый старт

```sh
npm ci --legacy-peer-deps   # установка (UI пинит несколько peer-диапазонов)
npm run dev                 # vite dev-сервер на http://localhost:5173/ui/
npm run build               # production-сборка в dist/
npm run lint                # eslint
npm test                    # vitest run
```

`npm run dev` проксирует `/v1`, `/healthz`, `/readyz` и `/openapi.yaml` на работающий
Keeper (по умолчанию `http://localhost:8080`). Указать другой адрес:

```sh
VITE_KEEPER_API=http://keeper.internal:8080 npm run dev
```

Поднять Keeper, с которым говорить, — по гайду ядра
[getting-started](https://github.com/souls-guild/soul-stack/blob/main/docs/getting-started.md).

## Синхронизация с ядром

TypeScript-типы UI генерируются из OpenAPI-спеки Keeper, завендоренной в
`vendor/openapi/keeper.yaml` (копия `docs/keeper/openapi.yaml` из core-репозитория). Когда
API меняется — обновите её:

```sh
cp ../soul-stack/docs/keeper/openapi.yaml vendor/openapi/keeper.yaml
npm run gen:api             # openapi-typescript → src/api/types.gen.ts
```

Завендоренный yaml коммитится; сгенерированный `src/api/types.gen.ts` — нет.

## AI-ассистенты

PR от AI-ассистентов приветствуются — но AI может ошибаться, и чем бы ни была написана
правка, **вы** отвечаете за её проверку перед отправкой. Перечитайте и прогоните
изменение (зелёные `npm run lint` / `npm run build` / `npm test` и внятное описание,
*почему* правка верна, сильно помогают) и уважайте процесс проектирования — контракт API и
словарь имён живут в core-репозитории. Правила одинаковы для людей и ассистентов; см.
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Контрибуция

Issues и pull request'ы открыты. Начните с [CONTRIBUTING.md](../../CONTRIBUTING.md) — там
про dev-окружение, гейт lint / build / test, CLA (подписывается один раз, на первом PR) и
соглашения по коду. Участвуя, вы принимаете
[Кодекс поведения](../../CODE_OF_CONDUCT.md).

## Безопасность и поддержка

- **Уязвимости безопасности** — сообщайте приватно, **не** публичным issue:
  [SECURITY.md](../../SECURITY.md) (`security@soul-stack.com` или приватный
  GitHub-advisory).
- **Баги и неожиданное поведение** —
  [GitHub Issues](https://github.com/souls-guild/soul-stack-web/issues) (шаблон «Bug
  report»). Приложите браузер, версию UI и вывод консоли.
- **Вопросы и куда написать** — [SUPPORT.md](../../SUPPORT.md). Поддержка в бете —
  best-effort, без SLA.

## Лицензия

Soul Stack Web — **[Business Source License 1.1](../../LICENSE)** (fair-code), та же
лицензия, что у ядра Soul Stack: исходники открыты, и **production-использование дано для
внутреннего использования** (управление своей или корпоративной инфраструктурой, в том
числе коммерческое). Иное production-использование — предложение третьим лицам как
hosted/managed-сервис, white-label или встраивание — требует коммерческой лицензии. Каждая
версия автоматически становится
**[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)** через два года после релиза
(Change Date), так что ограничение временное, а не постоянное. SDK и плагины Soul Stack —
под Apache 2.0.

Объяснение простым языком, что можно и что нельзя — [LICENSING.md](../../LICENSING.md). Имя
и логотип «Soul Stack» защищены [товарным знаком](../../TRADEMARK.md) отдельно от лицензии
на код.

## Ссылки

- **Сайт:** https://soul-stack.com (обзор, гайды, документация)
- **Репозиторий ядра:** https://github.com/souls-guild/soul-stack (Keeper / Souls / API)
