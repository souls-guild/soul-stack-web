import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// i18n Soul Stack UI.
// Языки: ru (default + fallback) / en. Выбор хранится в localStorage('lang').
// Имена сущностей (Archon / Keeper / Souls / Coven / Tide / …) НЕ переводятся —
// они либо хардкод English в JSX, либо identical в обоих locale.
//
// Ресурсы грузятся автоматически из locales/<lang>/<namespace>.json через
// import.meta.glob (Vite eager). Чтобы добавить namespace — просто положи пару
// файлов locales/ru/<ns>.json + locales/en/<ns>.json; init подхватит сам,
// править этот файл не нужно. Это позволяет наполнять разные namespace-файлы
// параллельно без конфликтов в одном JSON.

export const SUPPORTED_LANGS = ['ru', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'ru';
export const LANG_STORAGE_KEY = 'lang';

// Авто-сбор ресурсов из locales/<lang>/<ns>.json.
const localeModules = import.meta.glob('./locales/*/*.json', { eager: true });

type Resources = Record<string, Record<string, object>>;

function buildResources(): { resources: Resources; namespaces: string[] } {
  const resources: Resources = {};
  const nsSet = new Set<string>();
  for (const [path, mod] of Object.entries(localeModules)) {
    const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!m) continue;
    const [, lang, ns] = m;
    const data = (mod as { default?: object }).default ?? (mod as object);
    (resources[lang] ??= {})[ns] = data;
    nsSet.add(ns);
  }
  return { resources, namespaces: [...nsSet].sort() };
}

const { resources, namespaces } = buildResources();

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

i18n.use(initReactI18next).init({
  resources,
  lng: detectLang(),
  fallbackLng: DEFAULT_LANG,
  ns: namespaces,
  defaultNS: 'common',
  interpolation: {
    escapeValue: false, // React сам экранирует.
  },
  returnNull: false,
});

export function changeLang(lng: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  void i18n.changeLanguage(lng);
}

export default i18n;
