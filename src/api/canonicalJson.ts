/**
 * A stable string for VALUE comparison of two request bodies.
 *
 * `JSON.stringify` is key-order sensitive, and the two bodies being compared here
 * are built by different code: one from the form's controls (catalog order, with
 * the secret fields appended after the plain ones), the other from the record the
 * server returned (its own serialisation order). Those orders do not match for
 * most channel types, so a raw stringify comparison reports "different" for two
 * identical payloads and the guard it feeds never fires.
 *
 * Sorting object keys recursively removes that. ARRAY order is preserved on
 * purpose: `event_types` and `projection` are ordered lists the operator can
 * reorder, and treating a reorder as a no-op would discard a real edit.
 *
 * `undefined` members are dropped, matching what `JSON.stringify` does on the
 * wire — a field the form leaves undefined and one the record omits are the same
 * request.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = sortKeys(v);
  }
  return out;
}
