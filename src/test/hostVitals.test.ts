import { describe, it, expect } from 'vitest';
import {
  utilTone,
  ratioPct,
  formatPct,
  formatLoad,
  formatMb,
  formatUptime,
  formatBps,
  formatBpsShort,
  inodePct,
  busiestDisk,
  busiestInode,
  skewMinutes,
  ageSeconds,
  minMaxLast,
  spanSeconds,
  sortDisksByUsage,
  sortDisks,
  nearestIndex,
  formatClock,
  formatAgeShort,
  axisTicks,
} from '../pages/incarnations/hostVitals';

describe('hostVitals', () => {
  it('utilTone: 70/90 thresholds', () => {
    expect(utilTone(0)).toBe('ok');
    expect(utilTone(69.9)).toBe('ok');
    expect(utilTone(70)).toBe('warn');
    expect(utilTone(89.9)).toBe('warn');
    expect(utilTone(90)).toBe('danger');
    expect(utilTone(null)).toBe('ok');
    expect(utilTone(undefined)).toBe('ok');
  });

  it('ratioPct: guards zero/invalid total', () => {
    expect(ratioPct(50, 100)).toBe(50);
    expect(ratioPct(1, 0)).toBeNull();
    expect(ratioPct(1, -5)).toBeNull();
    expect(ratioPct(NaN, 100)).toBeNull();
  });

  it('formatPct: rounding and dash', () => {
    expect(formatPct(42.4)).toBe('42%');
    expect(formatPct(42.6)).toBe('43%');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
  });

  it('formatLoad: 2 decimals, dash on nil/NaN', () => {
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

  it('formatUptime: compact units', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(100000)).toBe('1d 3h');
    expect(formatUptime(-1)).toBe('—');
    expect(formatUptime(null)).toBe('—');
  });

  it('busiestDisk: highest used%', () => {
    expect(busiestDisk(null)).toBeNull();
    expect(busiestDisk([])).toBeNull();
    expect(
      busiestDisk([
        { mount: '/', used_mb: 5000, total_mb: 10000, inodes_used: 0, inodes_total: 0 },
        { mount: '/data', used_mb: 9000, total_mb: 10000, inodes_used: 0, inodes_total: 0 },
      ]),
    ).toEqual({ mount: '/data', pct: 90 });
  });

  it('formatBps: B/KB/MB/GB per sec, dash on nil/NaN/<0', () => {
    expect(formatBps(0)).toBe('0 B/s');
    expect(formatBps(512)).toBe('512 B/s');
    expect(formatBps(2048)).toBe('2.0 KB/s');
    expect(formatBps(5 * 1024 * 1024)).toBe('5.0 MB/s');
    expect(formatBps(3 * 1024 * 1024 * 1024)).toBe('3.0 GB/s');
    expect(formatBps(-1)).toBe('—');
    expect(formatBps(null)).toBe('—');
    expect(formatBps(undefined)).toBe('—');
    expect(formatBps(NaN)).toBe('—');
  });

  it('formatBpsShort: terse KB/s (no decimals) for tight axis labels', () => {
    expect(formatBpsShort(0)).toBe('0 B/s');
    expect(formatBpsShort(495000)).toBe('483 KB/s'); // 483.4 → 483, not "483.4 KB/s"
    expect(formatBpsShort(2048)).toBe('2 KB/s');
    expect(formatBpsShort(5 * 1024 * 1024)).toBe('5.0 MB/s');
    expect(formatBpsShort(-1)).toBe('—');
    expect(formatBpsShort(null)).toBe('—');
  });

  it('inodePct: percent, null when total<=0', () => {
    expect(inodePct(50, 200)).toBe(25);
    expect(inodePct(1, 0)).toBeNull();
    expect(inodePct(1, -5)).toBeNull();
  });

  it('busiestInode: highest inode used%, null when no fs reports inodes', () => {
    expect(busiestInode(null)).toBeNull();
    expect(
      busiestInode([
        { mount: '/', used_mb: 0, total_mb: 1, inodes_used: 10, inodes_total: 100 },
        { mount: '/data', used_mb: 0, total_mb: 1, inodes_used: 80, inodes_total: 100 },
      ]),
    ).toEqual({ mount: '/data', pct: 80 });
    expect(
      busiestInode([{ mount: '/', used_mb: 0, total_mb: 1, inodes_used: 0, inodes_total: 0 }]),
    ).toBeNull();
  });

  it('skewMinutes: > 10 min else null', () => {
    expect(skewMinutes('2026-05-26T10:00:00Z', '2026-05-26T10:05:00Z')).toBeNull();
    expect(skewMinutes('2026-05-26T10:00:00Z', '2026-05-26T10:11:00Z')).toBe(11);
    expect(skewMinutes(undefined, '2026-05-26T10:00:00Z')).toBeNull();
    expect(skewMinutes('bad', 'also-bad')).toBeNull();
  });

  it('ageSeconds: >= 0 from now, future→0', () => {
    const now = new Date('2026-05-26T10:00:30Z').getTime();
    expect(ageSeconds('2026-05-26T10:00:00Z', now)).toBe(30);
    expect(ageSeconds('2026-05-26T10:01:00Z', now)).toBe(0);
    expect(ageSeconds(undefined, now)).toBeNull();
    expect(ageSeconds('bad', now)).toBeNull();
  });

  it('minMaxLast: ignores non-finite, last = newest finite', () => {
    expect(minMaxLast([3, 1, 4, 1, 5])).toEqual({ min: 1, max: 5, last: 5 });
    expect(minMaxLast([NaN, 2, Infinity, 7])).toEqual({ min: 2, max: 7, last: 7 });
    expect(minMaxLast([])).toBeNull();
    expect(minMaxLast([NaN])).toBeNull();
  });

  it('spanSeconds: absolute diff, guards missing/broken', () => {
    expect(spanSeconds('2026-05-26T10:00:00Z', '2026-05-26T10:02:00Z')).toBe(120);
    expect(spanSeconds('2026-05-26T10:02:00Z', '2026-05-26T10:00:00Z')).toBe(120);
    expect(spanSeconds(undefined, '2026-05-26T10:00:00Z')).toBeNull();
    expect(spanSeconds('bad', 'nope')).toBeNull();
  });

  it('sortDisksByUsage: used% desc, invalid sinks, no mutation', () => {
    const disks = [
      { mount: '/a', used_mb: 10, total_mb: 100, inodes_used: 0, inodes_total: 0 }, // 10%
      { mount: '/b', used_mb: 90, total_mb: 100, inodes_used: 0, inodes_total: 0 }, // 90%
      { mount: '/z', used_mb: 5, total_mb: 0, inodes_used: 0, inodes_total: 0 }, // invalid
      { mount: '/c', used_mb: 50, total_mb: 100, inodes_used: 0, inodes_total: 0 }, // 50%
    ];
    const orig = [...disks];
    const sorted = sortDisksByUsage(disks);
    expect(sorted.map((d) => d.mount)).toEqual(['/b', '/c', '/a', '/z']);
    expect(disks).toEqual(orig); // input untouched
    expect(sortDisksByUsage(null)).toEqual([]);
    expect(sortDisksByUsage(undefined)).toEqual([]);
  });

  it('sortDisks: each key + both directions, n/a sinks, no mutation', () => {
    const disks = [
      { mount: '/b', used_mb: 90, total_mb: 100, inodes_used: 10, inodes_total: 100 }, // sp 90 / ino 10
      { mount: '/a', used_mb: 10, total_mb: 100, inodes_used: 80, inodes_total: 100 }, // sp 10 / ino 80
      { mount: '/c', used_mb: 50, total_mb: 100, inodes_used: 0, inodes_total: 0 }, // sp 50 / ino n/a
      { mount: '/z', used_mb: 5, total_mb: 0, inodes_used: 40, inodes_total: 100 }, // sp n/a / ino 40
    ];
    const orig = JSON.parse(JSON.stringify(disks));

    // mount
    expect(sortDisks(disks, 'mount', 'asc').map((d) => d.mount)).toEqual(['/a', '/b', '/c', '/z']);
    expect(sortDisks(disks, 'mount', 'desc').map((d) => d.mount)).toEqual(['/z', '/c', '/b', '/a']);

    // space: valid by used% then invalid (/z) last, both directions
    expect(sortDisks(disks, 'space', 'desc').map((d) => d.mount)).toEqual(['/b', '/c', '/a', '/z']);
    expect(sortDisks(disks, 'space', 'asc').map((d) => d.mount)).toEqual(['/a', '/c', '/b', '/z']);

    // inodes: valid by inode% then invalid (/c) last, both directions
    expect(sortDisks(disks, 'inodes', 'desc').map((d) => d.mount)).toEqual(['/a', '/z', '/b', '/c']);
    expect(sortDisks(disks, 'inodes', 'asc').map((d) => d.mount)).toEqual(['/b', '/z', '/a', '/c']);

    expect(disks).toEqual(orig); // input untouched
    expect(sortDisks(null, 'space', 'desc')).toEqual([]);
    expect(sortDisks(undefined, 'mount', 'asc')).toEqual([]);
  });

  it('nearestIndex: snaps to closest, clamps, NaN/empty → 0', () => {
    expect(nearestIndex(5, 0)).toBe(0);
    expect(nearestIndex(5, 1)).toBe(4);
    expect(nearestIndex(5, 0.5)).toBe(2);
    expect(nearestIndex(5, 0.6)).toBe(2); // 0.6*4=2.4 → 2
    expect(nearestIndex(5, 2)).toBe(4); // clamp high
    expect(nearestIndex(5, -1)).toBe(0); // clamp low
    expect(nearestIndex(0, 0.5)).toBe(0);
    expect(nearestIndex(3, NaN)).toBe(0);
  });

  it('formatClock: UTC HH:MM:SS, dash on missing/broken', () => {
    expect(formatClock('2026-05-26T10:05:09Z')).toBe('10:05:09');
    expect(formatClock('2026-05-26T00:00:00Z')).toBe('00:00:00');
    expect(formatClock(undefined)).toBe('—');
    expect(formatClock('nope')).toBe('—');
  });

  it('formatAgeShort: compact units, empty on nil/NaN/<0', () => {
    expect(formatAgeShort(5)).toBe('5s ago');
    expect(formatAgeShort(90)).toBe('1m ago');
    expect(formatAgeShort(3700)).toBe('1h ago');
    expect(formatAgeShort(90000)).toBe('1d ago');
    expect(formatAgeShort(null)).toBe('');
    expect(formatAgeShort(-1)).toBe('');
  });

  it('axisTicks: [top=hi, mid, bottom=lo], degenerate lo==hi', () => {
    expect(axisTicks(0, 100)).toEqual([100, 50, 0]);
    expect(axisTicks(20, 40)).toEqual([40, 30, 20]);
    expect(axisTicks(5, 5)).toEqual([5, 5, 5]);
  });
});
