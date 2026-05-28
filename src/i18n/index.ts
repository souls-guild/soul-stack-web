import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';

// i18n Soul Stack UI — hybrid lazy-load.
// Default-язык ru — bundled inline (мгновенный первый рендер, без мигания):
// eager-glob грузит только locales/ru/<ns>.json в JS-бандл.
// Остальные языки (en + будущие) — static-файлы public/locales/<lang>/<ns>.json,
// фетчатся через i18next-http-backend ТОЛЬКО при переключении на язык; в бандл
// не попадают. Добавить язык: положить public/locales/<lang>/*.json + код в
// SUPPORTED_LANGS. Добавить ключ: ru в src/i18n/locales/ru/<ns>.json + en в
// public/locales/en/<ns>.json (оба обязательны, ns-key-sync тест проверяет).
// Список namespace выводится из ru-файлов — добавление ns не требует правки тут.

export const SUPPORTED_LANGS = ['ru', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'ru';
export const LANG_STORAGE_KEY = 'lang';

// Inline-ресурсы default-языка (только ru) — bundled.
const ruModules = import.meta.glob('./locales/ru/*.json', { eager: true });

type NsBundle = Record<string, object>;

function buildRuInline(): { ruBundle: NsBundle; namespaces: string[] } {
  const ruBundle: NsBundle = {};
  for (const [path, mod] of Object.entries(ruModules)) {
    const m = path.match(/\.\/locales\/ru\/([^/]+)\.json$/);
    if (!m) continue;
    const [, ns] = m;
    ruBundle[ns] = (mod as { default?: object }).default ?? (mod as object);
  }
  return { ruBundle, namespaces: Object.keys(ruBundle).sort() };
}

const { ruBundle, namespaces } = buildRuInline();

function detectLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // localStorage недоступен (private mode / quota) — fallback на default.
  }
  return DEFAULT_LANG;
}

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    resources: { ru: ruBundle }, // default inline, остальные языки — backend.
    partialBundledLanguages: true, // позволяет миксовать inline + http-backend.
    lng: detectLang(),
    fallbackLng: DEFAULT_LANG,
    ns: namespaces,
    defaultNS: 'common',
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false, // React сам экранирует.
    },
    returnNull: false,
  });

// Переключение языка. Для non-default (en+) i18next-http-backend async-загрузит
// namespace по HTTP; до резолва i18next держит текущие строки (мигания/краша нет).
// Возвращает промис загрузки — LangToggle использует его для disabled-состояния.
export function changeLang(lng: Lang): Promise<unknown> {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  return i18n.changeLanguage(lng);
}

export default i18n;
