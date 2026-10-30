/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { MaintenanceCalendar } from '../pages/incarnations/MaintenanceCalendar';

describe('MaintenanceCalendar', () => {
  const props = { windows: [], freezes: [], tz: 'Europe/Moscow', canWrite: true, onEditWindow: vi.fn(), onEditFreeze: vi.fn() };
  // Sun 01.11 23:59 and Mon 02.11 00:01 in Moscow.
  const SUN_LATE = new Date('2026-11-01T20:59:00Z');
  const MON_EARLY = new Date('2026-11-01T21:01:00Z');

  it('[GUARD] left open over midnight, the week moves on with the date until the operator steps away', async () => {
    const { rerender } = renderWithProviders(<MaintenanceCalendar {...props} now={SUN_LATE} />);
    const range = screen.getByTestId('mw-cal-range');
    expect(range.textContent).toBe('26 October – 1 November 2026');

    rerender(<MaintenanceCalendar {...props} now={MON_EARLY} />);
    expect(range.textContent).toBe('2 – 8 November 2026');
    expect(screen.getByTestId('mw-cal-day-2026-11-02').dataset.today).toBe('true');

    // A week the operator picked stays where it is.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('mw-cal-next'));
    expect(range.textContent).toBe('9 – 15 November 2026');
    rerender(<MaintenanceCalendar {...props} now={new Date('2026-11-03T09:00:00Z')} />);
    expect(range.textContent).toBe('9 – 15 November 2026');
  });

  // jsdom does no hit-testing, so the layering that decides what a click on a cancelled
  // window reaches is read from the stylesheet itself.
  it('[GUARD] windows lie above freezes, and nothing on a freeze lifts it over them', () => {
    const cssText = readFileSync(path.resolve('src/pages/incarnations/MaintenanceCalendar.module.css'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...cssText.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
    const zOf = (sel: string) => {
      const rule = rules.find((r) => r.sel === sel);
      expect(rule, `rule ${sel}`).toBeDefined();
      return /z-index:\s*([^;]+);/.exec(rule!.body)?.[1].trim();
    };

    expect(Number(zOf('.blk'))).toBeGreaterThanOrEqual(1);
    expect(zOf('.freeze')).toBe('auto');
    expect(Number(zOf('.freezeWords'))).toBeGreaterThan(Number(zOf('.blk')));
    // Any other rule reaching a freeze must not give it a z-index, or a filter, opacity
    // or transform, which would make it a stacking context lifted as one piece.
    for (const r of rules) {
      const touchesFreeze = /(^|[\s,])(button)?\.freeze(?![\w-])/.test(r.sel) && r.sel !== '.freeze';
      const touchesEveryBlock = /(^|,)\s*button\.blk(:[\w-]+)?\s*(,|$)/.test(r.sel);
      if (!touchesFreeze && !touchesEveryBlock) continue;
      expect(r.body, r.sel).not.toMatch(/z-index|filter|opacity|transform/);
    }
  });
});
