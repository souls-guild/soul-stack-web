// The display time zone (NIM-1154): one per browser, kept like the language and the
// theme. Instants are shown and typed in it; a weekly maintenance window keeps its
// own zone, which this does not touch.
import { useSyncExternalStore } from 'react';
import { browserTimeZone, isValidTimeZone } from '../pages/incarnations/maintenance';
import { BROWSER_ZONE, TIME_ZONE_STORAGE_KEY } from './timeZoneConstants';

export { BROWSER_ZONE, TIME_ZONE_STORAGE_KEY };

const listeners = new Set<() => void>();
// A choice the storage refused (private mode, quota): kept for this page at least.
let unsaved: string | null = null;

/** BROWSER_ZONE (the default), 'UTC' or an IANA name. */
export function timeZonePref(): string {
  if (unsaved !== null) return unsaved;
  try {
    const v = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
    if (v && v !== BROWSER_ZONE && isValidTimeZone(v)) return v;
  } catch {
    // private mode / quota
  }
  return BROWSER_ZONE;
}

export function setTimeZonePref(pref: string): void {
  try {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, pref);
    unsaved = null;
  } catch {
    unsaved = pref;
  }
  for (const l of listeners) l();
}

/** The zone the preference stands for now. Outside React: form schemas. */
export function displayTimeZone(): string {
  const pref = timeZonePref();
  return pref === BROWSER_ZONE ? browserTimeZone() : pref;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === TIME_ZONE_STORAGE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface TimeZoneState {
  pref: string;
  /** The resolved IANA zone (or 'UTC'). */
  tz: string;
  /** The zone is the browser's own rather than one chosen. */
  browser: boolean;
  setPref: (pref: string) => void;
}

export function useTimeZone(): TimeZoneState {
  const pref = useSyncExternalStore(subscribe, timeZonePref, () => BROWSER_ZONE);
  const browser = pref === BROWSER_ZONE;
  return { pref, tz: browser ? browserTimeZone() : pref, browser, setPref: setTimeZonePref };
}
