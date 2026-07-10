import { describe, it, expect } from 'vitest';
import {
  utilTone,
  ratioPct,
  formatPct,
  formatLoad,
  formatMb,
  formatUptime,
  busiestDisk,
  skewMinutes,
  ageSeconds,
} from '../pages/incarnations/hostVitals';

describe('hostVitals', () => {
  it('utilTone: пороги 70/90', () => {
    expect(utilTone(0)).toBe('ok');
    expect(utilTone(69.9)).toBe('ok');
    expect(utilTone(70)).toBe('warn');
    expect(utilTone(89.9)).toBe('warn');
    expect(utilTone(90)).toBe('danger');
    expect(utilTone(null)).toBe('ok');
    expect(utilTone(undefined)).toBe('ok');
  });

  it('ratioPct: гард нулевого/битого total', () => {
    expect(ratioPct(50, 100)).toBe(50);
    expect(ratioPct(1, 0)).toBeNull();
    expect(ratioPct(1, -5)).toBeNull();
    expect(ratioPct(NaN, 100)).toBeNull();
  });

  it('formatPct: округление и прочерк', () => {
    expect(formatPct(42.4)).toBe('42%');
    expect(formatPct(42.6)).toBe('43%');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
  });

  it('formatLoad: 2 знака, прочерк на nil/NaN', () => {
    expect(formatLoad(1.2)).toBe('1.20');
    expect(formatLoad(0)).toBe('0.00');
    expect(formatLoad(null)).toBe('—');
    expect(formatLoad(undefined)).toBe('—');
    expect(formatLoad(NaN)).toBe('—');
  });

  it('formatMb: MB→GB', () => {
    expect(formatMb(512)).toBe('512 MB');
    expect(formatMb(1024)).toBe('1.0 GB');
    expect(formatMb(3277)).toBe('3.2 GB');
    expect(formatMb(null)).toBe('—');
  });

  it('formatUptime: компактные единицы', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(100000)).toBe('1d 3h');
    expect(formatUptime(-1)).toBe('—');
    expect(formatUptime(null)).toBe('—');
  });

  it('busiestDisk: максимальный used%', () => {
    expect(busiestDisk(null)).toBeNull();
    expect(busiestDisk([])).toBeNull();
    expect(
      busiestDisk([
        { mount: '/', used_mb: 5000, total_mb: 10000 },
        { mount: '/data', used_mb: 9000, total_mb: 10000 },
      ]),
    ).toEqual({ mount: '/data', pct: 90 });
  });

  it('skewMinutes: > 10 мин иначе null', () => {
    expect(skewMinutes('2026-05-26T10:00:00Z', '2026-05-26T10:05:00Z')).toBeNull();
    expect(skewMinutes('2026-05-26T10:00:00Z', '2026-05-26T10:11:00Z')).toBe(11);
    expect(skewMinutes(undefined, '2026-05-26T10:00:00Z')).toBeNull();
    expect(skewMinutes('bad', 'also-bad')).toBeNull();
  });

  it('ageSeconds: >= 0 от now, future→0', () => {
    const now = new Date('2026-05-26T10:00:30Z').getTime();
    expect(ageSeconds('2026-05-26T10:00:00Z', now)).toBe(30);
    expect(ageSeconds('2026-05-26T10:01:00Z', now)).toBe(0);
    expect(ageSeconds(undefined, now)).toBeNull();
    expect(ageSeconds('bad', now)).toBeNull();
  });
});
