// CLIENT-SIDE date-range filter for run lists (NOT server-side).
//
// At the time of writing, the backend does not return a unified started_at
// range for all run endpoints: errands/errand-runs accept only `started_after`
// (lower bound, no upper), while tides/push-runs have no date params at all. So
// the range is applied client-side over the ALREADY LOADED page (LIMIT-sized
// selection), not translated into the query. A proper server-side range needs
// a backend `started_after`/`started_before` param on all list endpoints —
// filed as a separate task against core.
//
// Input contract — `<input type="date">` (value `YYYY-MM-DD` in local
// timezone, or ''). `from` includes from start of day, `to` — through end of
// day (both bounds inclusive). An invalid/empty row ts does NOT fall into the
// selection when a range is set (nothing to compare).

export interface DateRange {
  from: string; // 'YYYY-MM-DD' | ''
  to: string; // 'YYYY-MM-DD' | ''
}

export const EMPTY_DATE_RANGE: DateRange = { from: '', to: '' };

export function hasDateRange(r: DateRange): boolean {
  return r.from !== '' || r.to !== '';
}

// from -> start of day (00:00:00.000), to -> end of day (23:59:59.999), local
// timezone. Invalid date -> null (bound ignored).
function dayStart(date: string): number | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dayEnd(date: string): number | null {
  if (!date) return null;
  const d = new Date(`${date}T23:59:59.999`);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Predicate "ts falls within range". Empty range -> always true.
export function inDateRange(ts: string | undefined, r: DateRange): boolean {
  if (!hasDateRange(r)) return true;
  if (!ts) return false;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  const lo = dayStart(r.from);
  const hi = dayEnd(r.to);
  if (lo !== null && t < lo) return false;
  if (hi !== null && t > hi) return false;
  return true;
}

// SERVER-SIDE started_at range: local dates from/to -> ISO bounds
// (from -> start of day -> started_after; to -> end of day -> started_before).
// Empty/invalid bound -> field omitted.
export function toServerRange(r: DateRange): { started_after?: string; started_before?: string } {
  const out: { started_after?: string; started_before?: string } = {};
  const lo = dayStart(r.from);
  if (lo !== null) out.started_after = new Date(lo).toISOString();
  const hi = dayEnd(r.to);
  if (hi !== null) out.started_before = new Date(hi).toISOString();
  return out;
}
