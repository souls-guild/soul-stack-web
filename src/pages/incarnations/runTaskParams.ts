import type { RunTaskParamCell } from '../../api/keeper';

// Params value for a kv-line: scalar as-is, object/array — compact JSON.
export function paramValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// A host's whole text: the base with every hunk's line range replaced by that host's
// variant. The keeper guarantees disjoint, ascending hunks that list every host.
export function hostText(base: string[], hunks: RunTaskParamCell[], sid: string): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const h of hunks) {
    const start = (h.line ?? 1) - 1;
    out.push(...base.slice(pos, start));
    const own = (h.values ?? []).find((v) => (v.sids ?? []).includes(sid));
    out.push(...(own?.lines ?? []));
    pos = start + (h.line_count ?? 0);
  }
  out.push(...base.slice(pos));
  return out;
}
