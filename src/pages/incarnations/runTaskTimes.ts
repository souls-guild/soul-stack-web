// When a run and its steps started and how long they ran (NIM-1170, NIM-1177). The
// Keeper sends the instants; the wall clock and the duration are drawn here, in the
// display time zone.
import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import type { RunTaskView } from '../../api/keeper';

export interface StepTimes {
  startedAt?: string;
  finishedAt?: string;
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallParts(iso: string, tz: string): ((type: string) => string) | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let f = wallFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallFormatters.set(tz, f);
  }
  const parts = f.formatToParts(d);
  return (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
}

/** "14:03:27" of an instant in `tz`; '' for a broken one. */
export function clockInZone(iso: string, tz: string): string {
  const get = wallParts(iso, tz);
  return get ? `${get('hour')}:${get('minute')}:${get('second')}` : '';
}

/** "31.10.2026 14:03:27" of an instant in `tz`; '' for a broken one. */
export function instantInZone(iso: string, tz: string): string {
  const get = wallParts(iso, tz);
  return get ? `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}:${get('second')}` : '';
}

/** Whole seconds from `from` to `to`; null when either is broken. A clock behind the Keeper's reads 0, not a negative. */
export function elapsedSeconds(from: string, to: string | number): number | null {
  const a = new Date(from).getTime();
  const b = typeof to === 'number' ? to : new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 1000));
}

/** "4 s", "15 min 0 s", "2 h 3 min 0 s". Units are abbreviated, so no plural forms. */
export function formatDuration(t: TFunction, sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return t('runhistory:runStepDurHMS', { h, m, s });
  if (m > 0) return t('runhistory:runStepDurMS', { m, s });
  return t('runhistory:runStepDurS', { s });
}

/**
 * The hosts a row of the step list stands for: a wave's, narrowed by the host filter.
 * null — the whole task, which reads the task's own times.
 */
export function scopeSids(wave: { sids: string[] } | undefined, host: string | null): string[] | null {
  if (!wave && !host) return null;
  const sids = wave ? wave.sids : [host as string];
  return host ? sids.filter((s) => s === host) : sids;
}

/**
 * The times of a row. A whole task reads the Keeper's fold. A wave or a host reads its
 * hosts' own: started when the first of them did, and finished at the last finish once
 * none of them can still be at the task — every one has reported it, the Keeper says
 * the whole task finished, the wave has ended, or the run is over. A host that never
 * reports a task was not sent it, and must not hold a row open while others run.
 * hosts[] lists only hosts with a result, so a host still at the task gives the row no
 * start of its own.
 */
export function rowTimes(task: RunTaskView, sids: string[] | null, live: boolean, scopeOver: boolean): StepTimes {
  if (sids === null) return { startedAt: task.started_at, finishedAt: task.finished_at };
  const hosts = (task.hosts ?? []).filter((h) => sids.includes(h.sid));
  let startedAt: string | undefined;
  let finishedAt: string | undefined;
  for (const h of hosts) {
    if (h.started_at && (!startedAt || Date.parse(h.started_at) < Date.parse(startedAt))) startedAt = h.started_at;
    if (h.finished_at && (!finishedAt || Date.parse(h.finished_at) > Date.parse(finishedAt))) finishedAt = h.finished_at;
  }
  const reported = sids.every((sid) => hosts.some((h) => h.sid === sid && h.finished_at));
  const over = reported || !live || task.finished_at != null || scopeOver;
  return { startedAt, finishedAt: over ? finishedAt : undefined };
}

/** The current time, ticking every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The row's duration and its full phrase: "started 14:03:27 · took 15 min 0 s", or
 * "· running 3 min 2 s" for a task still going in a live run. A task with a start and
 * no finish in a run that is over reads only its start: it ran, nobody knows how long.
 */
export function describeTimes(
  t: TFunction,
  times: StepTimes,
  tz: string,
  live: boolean,
  now: number,
): { duration: string; phrase: string; running: boolean } | null {
  if (!times.startedAt) return null;
  const at = clockInZone(times.startedAt, tz);
  if (!at) return null;
  const end = times.finishedAt ?? (live ? now : undefined);
  const sec = end === undefined ? null : elapsedSeconds(times.startedAt, end);
  if (sec === null) return { duration: '', phrase: t('runhistory:runStepStarted', { at }), running: false };
  const duration = formatDuration(t, sec);
  const running = !times.finishedAt;
  return {
    duration,
    phrase: t(running ? 'runhistory:runStepRunning' : 'runhistory:runStepTook', { at, dur: duration }),
    running,
  };
}
