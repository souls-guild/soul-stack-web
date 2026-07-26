// Persisted console preferences: how the wall looks, and the groups the
// operator defined.
//
// Both survive a reload because both are work the operator did by hand — a
// font size chosen so the output fits, a set of groups written for this fleet.
// Losing either on refresh means doing that work again.
//
// Everything is validated on read: localStorage is user-writable and may hold
// values from an older build, and a bad number here would reach xterm or CSS.

import type { GroupDef } from './consoleGrouping';

const VIEW_KEY = 'soul-stack.console.view';
const GROUPS_KEY = 'soul-stack.console.groups';

export const COLUMN_CHOICES = [2, 3, 4] as const;
export type Columns = (typeof COLUMN_CHOICES)[number];

// Terminal font size in px. Small end is for fitting wide output (long log
// lines, `docker ps`), large end for reading over someone's shoulder.
export const FONT_SIZES = [10, 11, 12, 13, 14, 16] as const;
export type FontSize = (typeof FONT_SIZES)[number];

// Wall row height in px. Taller rows mean more scrollback visible per host.
export const ROW_HEIGHTS = [260, 340, 460, 620] as const;
export type RowHeight = (typeof ROW_HEIGHTS)[number];

export interface ConsoleViewPrefs {
  columns: Columns;
  fontSize: FontSize;
  rowHeight: RowHeight;
}

export const DEFAULT_VIEW_PREFS: ConsoleViewPrefs = {
  columns: 3,
  fontSize: 12,
  rowHeight: 340,
};

function pick<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'number' && (allowed as readonly number[]).includes(value) ? (value as T) : fallback;
}

export function loadViewPrefs(): ConsoleViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_VIEW_PREFS;
    const p = parsed as Record<string, unknown>;
    return {
      columns: pick(p.columns, COLUMN_CHOICES, DEFAULT_VIEW_PREFS.columns),
      fontSize: pick(p.fontSize, FONT_SIZES, DEFAULT_VIEW_PREFS.fontSize),
      rowHeight: pick(p.rowHeight, ROW_HEIGHTS, DEFAULT_VIEW_PREFS.rowHeight),
    };
  } catch {
    // Unavailable (private mode / quota) or corrupt — defaults are fine.
    return DEFAULT_VIEW_PREFS;
  }
}

export function saveViewPrefs(prefs: ConsoleViewPrefs): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// Groups are restored by value, not by identity: ids are regenerated on load so
// a persisted id can never collide with one minted this session.
export function loadGroups(mintId: () => string): GroupDef[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: GroupDef[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const g = item as Record<string, unknown>;
      if (typeof g.name !== 'string' || typeof g.query !== 'string') continue;
      out.push({ id: mintId(), name: g.name, query: g.query });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveGroups(defs: readonly GroupDef[]): void {
  try {
    // Ids are session-local; persisting them would be misleading on restore.
    localStorage.setItem(GROUPS_KEY, JSON.stringify(defs.map((d) => ({ name: d.name, query: d.query }))));
  } catch {
    // ignore
  }
}
