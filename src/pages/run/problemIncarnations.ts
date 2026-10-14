// An incarnation a scenario run cannot start on: its status and the run it points
// at — the run that locked it (status_details.apply_id) or the one applying it now
// (applying_apply_id); '' when the row names none.
export interface ProblemIncarnation {
  status: string;
  runId: string;
}

// The statuses a scenario run starts from — parity with Keeper's lockRun.
const RUNNABLE = new Set(['ready', 'drift']);

export function problemIncarnations(
  items: ReadonlyArray<{
    id: string;
    status: string;
    status_details?: Record<string, unknown> | null;
    applying_apply_id?: string | null;
  }>,
): Record<string, ProblemIncarnation> {
  const out: Record<string, ProblemIncarnation> = {};
  for (const i of items) {
    if (RUNNABLE.has(i.status)) continue;
    let runId = '';
    if (i.status === 'error_locked') {
      const applyId = i.status_details?.['apply_id'];
      runId = typeof applyId === 'string' ? applyId : '';
    } else if (i.status === 'applying') {
      runId = i.applying_apply_id ?? '';
    }
    out[i.id] = { status: i.status, runId };
  }
  return out;
}

// Screen order of problem kinds: the one that blocks the run first, then the one
// that clears by itself, then the rest by name.
export function problemStatusRank(status: string): string {
  if (status === 'error_locked') return '0';
  if (status === 'applying') return '1';
  return `2${status}`;
}
