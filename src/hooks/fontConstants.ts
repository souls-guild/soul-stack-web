// Interface font - an independent selector (symmetric with theme), see themeConstants.ts.
// All modes except system are self-hosted @font-face (src/styles/fonts.css),
// files in public/fonts/ - not Google Fonts CDN, to work under keeper /ui
// embed offline. comic-neue and quicksand don't have a cyrillic subset
// upstream (latin decorative fonts) - cyrillic in these modes
// falls back to var(--font-sans) via the fallback in the stack below.
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
