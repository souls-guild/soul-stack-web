import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';

// i18n Soul Stack UI — hybrid lazy-load.
// Default language en — bundled inline (instant first render, no flash):
// eager-glob loads only locales/en/<ns>.json into the JS bundle.
// Other languages (ru + future) are static files public/locales/<lang>/<ns>.json,
// fetched via i18next-http-backend ONLY when switching to that language; they
// never enter the bundle. Add a language: drop public/locales/<lang>/*.json + a
// code in SUPPORTED_LANGS. Add a key: en in src/i18n/locales/en/<ns>.json + ru in
// public/locales/ru/<ns>.json (both required, the ns-key-sync test checks it).
// The namespace list is derived from the en files — adding an ns needs no edit here.

export const SUPPORTED_LANGS = ['en', 'ru'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'en';
export const LANG_STORAGE_KEY = 'lang';

// Inline resources for the default language (en only) — bundled.
const enModules = import.meta.glob('./locales/en/*.json', { eager: true });

type NsBundle = Record<string, object>;

function buildEnInline(): { enBundle: NsBundle; namespaces: string[] } {
  const enBundle: NsBundle = {};
  for (const [path, mod] of Object.entries(enModules)) {
    const m = path.match(/\.\/locales\/en\/([^/]+)\.json$/);
    if (!m) continue;
    const [, ns] = m;
    enBundle[ns] = (mod as { default?: object }).default ?? (mod as object);
  }
  return { enBundle, namespaces: Object.keys(enBundle).sort() };
}

const { enBundle, namespaces } = buildEnInline();

function detectLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // localStorage unavailable (private mode / quota) — fall back to default.
  }
  return DEFAULT_LANG;
}

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    resources: { en: enBundle }, // default inline, other languages via backend.
    partialBundledLanguages: true, // allows mixing inline + http-backend.
    lng: detectLang(),
    fallbackLng: DEFAULT_LANG,
    ns: namespaces,
    defaultNS: 'common',
    backend: {
      // import.meta.env.BASE_URL = '/ui/' at build time (base: '/ui/' in vite.config.ts).
      // An absolute path /locales/... 404s when the UI is embedded under /ui/ in Keeper.
      // BASE_URL keeps the prefix correct both in dev (/ui/) and in prod.
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
    },
    interpolation: {
      escapeValue: false, // React escapes on its own.
    },
    returnNull: false,
  });

// Language switch. For non-default (ru+) i18next-http-backend async-loads the
// namespace over HTTP; until it resolves i18next keeps the current strings (no
// flash/crash). Returns the load promise — LangToggle uses it for the disabled state.
export function changeLang(lng: Lang): Promise<unknown> {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  return i18n.changeLanguage(lng);
}

export default i18n;
