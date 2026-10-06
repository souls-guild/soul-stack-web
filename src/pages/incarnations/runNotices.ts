import type { RunHostStatusEntry } from '../../api/keeper';

type RunNotice = NonNullable<RunHostStatusEntry['notices']>[number];

export interface HostNotices {
  sid: string;
  notices: RunNotice[];
}

// A host has one row per Passage (per step once linear dispatch is on), and keeper
// dedupes notices within a row only, so a deprecated param passed in three units
// arrives on three rows. Merged here by (code, module, param) per host and sorted
// by that key, as keeper sorts a row, so the same set reads the same on every host;
// hosts with nothing to say are left out.
export function noticesByHost(rows: readonly RunHostStatusEntry[]): HostNotices[] {
  const out: HostNotices[] = [];
  const bySid = new Map<string, { entry: HostNotices; seen: Set<string> }>();
  for (const row of rows) {
    for (const n of row.notices ?? []) {
      let slot = bySid.get(row.sid);
      if (!slot) {
        slot = { entry: { sid: row.sid, notices: [] }, seen: new Set() };
        bySid.set(row.sid, slot);
        out.push(slot.entry);
      }
      const key = JSON.stringify([n.code, n.module, n.param ?? '']);
      if (slot.seen.has(key)) continue;
      slot.seen.add(key);
      slot.entry.notices.push(n);
    }
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const h of out) {
    h.notices.sort(
      (a, b) => cmp(a.code, b.code) || cmp(a.module, b.module) || cmp(a.param ?? '', b.param ?? ''),
    );
  }
  return out;
}
