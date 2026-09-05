// Normalized per-task model for the run's fallback timeline (NIM-37).
//
// The primary path (Schema-2 master-detail) takes a ready-made join from /runs/{apply_id}/tasks
// (RunTaskView) and doesn't need this model. These helpers serve ONLY the
// graceful fallback (backend /tasks not yet deployed): audit task.executed ->
// TaskRow -> TaskTimeline. SSE frames are no longer normalized into rows - SSE became
// a nudge (invalidates the query), see RunDetail.
export interface TaskRow {
  sid: string;
  taskIdx: number;
  passage: number;
  status: string; // TASK_STATUS_* (audit status)
  planIndex?: number; // global cross-cutting index
  errorCode?: string;
  errorModule?: string;
  // error.message intentionally NOT stored: an audit message may carry a secret - we
  // don't render it on screen (secret hygiene, NIM-37 review).
}

// Dedup/row key: task_idx is local within a Passage, so on its own it's
// not unique - combine with sid and passage.
export function taskRowKey(r: Pick<TaskRow, 'sid' | 'passage' | 'taskIdx'>): string {
  return `${r.sid}|${r.passage}|${r.taskIdx}`;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// normalizeAuditTaskPayload - from an audit-payload task.executed (`status`,
// has plan_index and error.message) into a TaskRow.
export function normalizeAuditTaskPayload(payload: unknown): TaskRow | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const sid = asString(p.sid);
  if (!sid) return null;
  const row: TaskRow = {
    sid,
    taskIdx: asNumber(p.task_idx, 0),
    passage: asNumber(p.passage, 0),
    status: asString(p.status) ?? '',
  };
  if (typeof p.plan_index === 'number') row.planIndex = p.plan_index;
  const err = p.error;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    row.errorCode = asString(e.code);
    row.errorModule = asString(e.module);
    // error.message deliberately NOT carried over (secret hygiene - not rendered).
  }
  return row;
}

export function sortTaskRows(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort(
    (a, b) => a.passage - b.passage || a.taskIdx - b.taskIdx || a.sid.localeCompare(b.sid),
  );
}
