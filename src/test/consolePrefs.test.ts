/**
 * NIM-146: persisted console preferences.
 *
 * localStorage is user-writable and may hold values from an older build, and
 * these numbers reach xterm (font size) and CSS (row height) directly — so the
 * only thing that really matters here is that nothing invalid gets through.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_VIEW_PREFS,
  loadGroups,
  loadViewPrefs,
  saveGroups,
  saveViewPrefs,
} from '../pages/console/consolePrefs';

const VIEW_KEY = 'soul-stack.console.view';
const GROUPS_KEY = 'soul-stack.console.groups';

let seq = 0;
const mintId = () => `g${(seq += 1)}`;

beforeEach(() => {
  localStorage.clear();
  seq = 0;
});

describe('view prefs', () => {
  it('round-trips a saved selection', () => {
    saveViewPrefs({ columns: 4, fontSize: 16, rowHeight: 620 });
    expect(loadViewPrefs()).toEqual({ columns: 4, fontSize: 16, rowHeight: 620 });
  });

  it('falls back to defaults when nothing is stored', () => {
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });

  it('[INVARIANT] rejects values outside the offered set', () => {
    // A font size of 0 or a negative row height would reach xterm and CSS.
    localStorage.setItem(VIEW_KEY, JSON.stringify({ columns: 99, fontSize: 0, rowHeight: -10 }));
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });

  it('keeps the valid fields when only one is corrupt', () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ columns: 2, fontSize: 'huge', rowHeight: 260 }));
    expect(loadViewPrefs()).toEqual({ columns: 2, fontSize: DEFAULT_VIEW_PREFS.fontSize, rowHeight: 260 });
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem(VIEW_KEY, '{not json');
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });
});

describe('groups', () => {
  it('round-trips name and query', () => {
    saveGroups([
      { id: 'x', name: 'shards', query: 'trait.role = data' },
      { id: 'y', name: 'control', query: 'choir = control' },
    ]);
    expect(loadGroups(mintId)).toEqual([
      { id: 'g1', name: 'shards', query: 'trait.role = data' },
      { id: 'g2', name: 'control', query: 'choir = control' },
    ]);
  });

  it('[INVARIANT] mints fresh ids rather than restoring stored ones', () => {
    // Tabs and their command drafts are keyed by id; a restored id colliding
    // with one minted this session would cross two groups' state.
    saveGroups([{ id: 'g1', name: 'a', query: 'coven = x' }]);
    expect(loadGroups(mintId)[0].id).toBe('g1');
    expect(loadGroups(() => 'fresh')[0].id).toBe('fresh');
  });

  it('drops malformed entries instead of failing the whole restore', () => {
    localStorage.setItem(
      GROUPS_KEY,
      JSON.stringify([{ name: 'ok', query: 'coven = x' }, { name: 42 }, null, 'nope']),
    );
    expect(loadGroups(mintId)).toEqual([{ id: 'g1', name: 'ok', query: 'coven = x' }]);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem(GROUPS_KEY, '{not json');
    expect(loadGroups(mintId)).toEqual([]);
    localStorage.setItem(GROUPS_KEY, JSON.stringify({ not: 'an array' }));
    expect(loadGroups(mintId)).toEqual([]);
  });
});
