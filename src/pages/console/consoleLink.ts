// Link into the console wall, preserving the target scope of whatever link the
// operator arrived on (bulk-run from a list page, a deep link with ?workload=console).

// Only the scope dimensions travel: workload-specific params (service, module,
// options) mean nothing to an interactive shell. `target_where` (raw CEL) is
// dropped on purpose — the browser cannot evaluate it, and carrying it would
// suggest a narrowing the scope form does not actually apply.
const CARRIED_PARAMS = [
  'incarnation',
  'target_incarnations',
  'target_sids',
  'target_coven',
  'target_glob',
  'target_regex',
  'target_soulprint',
];

export function consoleHrefFrom(params: URLSearchParams): string {
  const carried = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = params.get(key);
    if (value) carried.set(key, value);
  }
  const qs = carried.toString();
  return qs ? `/run/console?${qs}` : '/run/console';
}
