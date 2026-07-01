// Шрифт интерфейса — независимый селектор (симметрично theme), см. themeConstants.ts.
// Все режимы кроме system — self-hosted @font-face (src/styles/fonts.css),
// файлы в public/fonts/ — не Google Fonts CDN, чтобы работать под keeper /ui
// embed offline-контуром. comic-neue и quicksand не имеют cyrillic-субсета
// в апстриме (латинские декоративные шрифты) — кириллица в этих режимах
// откатывается на var(--font-sans) через fallback в стеке ниже.
export const FONT_MODES = [
  'system',
  'mono',
  'serif',
  'manrope',
  'quicksand',
  'unbounded',
  'caveat',
  'comfortaa',
  'comic-neue',
] as const;
export type FontMode = (typeof FONT_MODES)[number];
export const FONT_STORAGE_KEY = 'app-font';

export const FONT_STACKS: Record<FontMode, string> = {
  system: 'var(--font-sans)',
  mono: "'JetBrains Mono', var(--font-mono)",
  serif: "'Merriweather', Georgia, 'Times New Roman', serif",
  manrope: "'Manrope', var(--font-sans)",
  quicksand: "'Quicksand', var(--font-sans)",
  unbounded: "'Unbounded', var(--font-sans)",
  caveat: "'Caveat', var(--font-sans)",
  comfortaa: "'Comfortaa', var(--font-sans)",
  'comic-neue': "'Comic Neue', var(--font-sans)",
};
