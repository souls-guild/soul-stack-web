import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { toServerRange } from '../pages/runs/dateRange';

// toServerRange converts local midnight of the from/to bounds into UTC ISO instants
// (started_after/started_before). We pin the zone to UTC+3 without DST (Etc/GMT-3) to
// fix the local->UTC shift itself: under UTC the values would be the same regardless,
// so this test actually proves the offset is accounted for, not passing by accident.
describe('toServerRange (TZ=UTC+3)', () => {
  const origTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Etc/GMT-3';
  });
  afterAll(() => {
    if (origTZ === undefined) delete process.env.TZ;
    else process.env.TZ = origTZ;
  });

  it('from → начало дня, to → конец дня: локальная полночь UTC+3 → UTC-инстант', () => {
    const out = toServerRange({ from: '2026-07-04', to: '2026-07-04' });
    // 2026-07-04T00:00:00.000+03:00 → 2026-07-03T21:00:00.000Z
    expect(out.started_after).toBe('2026-07-03T21:00:00.000Z');
    // 2026-07-04T23:59:59.999+03:00 → 2026-07-04T20:59:59.999Z
    expect(out.started_before).toBe('2026-07-04T20:59:59.999Z');
  });

  it('пустая верхняя граница (to="") → started_before опущено', () => {
    const out = toServerRange({ from: '2026-07-04', to: '' });
    expect(out.started_after).toBe('2026-07-03T21:00:00.000Z');
    expect(out).not.toHaveProperty('started_before');
  });

  it('пустая нижняя граница (from="") → started_after опущено', () => {
    const out = toServerRange({ from: '', to: '2026-07-04' });
    expect(out).not.toHaveProperty('started_after');
    expect(out.started_before).toBe('2026-07-04T20:59:59.999Z');
  });

  it('обе границы пусты → пустой объект (оба поля опущены)', () => {
    expect(toServerRange({ from: '', to: '' })).toEqual({});
  });
});
