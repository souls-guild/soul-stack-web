export const THEME_MODES = ['light', 'dark', 'system', 'warm', 'deep'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const THEME_STORAGE_KEY = 'theme';
