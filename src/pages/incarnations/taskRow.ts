// Нормализованная per-task модель fallback-таймлайна прогона (NIM-37).
//
// Primary-путь (Схема-2 master-detail) берёт готовый join из /runs/{apply_id}/tasks
// (RunTaskView) и в этой модели НЕ нуждается. Эти хелперы обслуживают ТОЛЬКО
// graceful fallback (backend /tasks ещё не задеплоен): audit task.executed →
// TaskRow → TaskTimeline. SSE-кадры больше не нормализуются в строки — SSE стал
// nudge-ом (инвалидирует query), см. RunDetail.
export interface TaskRow {
  sid: string;
  taskIdx: number;
  passage: number;
  status: string; // TASK_STATUS_* (audit status)
  planIndex?: number; // глобальный сквозной индекс
  errorCode?: string;
  errorModule?: string;
  // error.message НЕ храним намеренно: audit-message может нести секрет — на экран
  // не выводим (секрет-гигиена, NIM-37 review).
  suppressed?: string;
}

// Ключ дедупликации/строки: task_idx локален внутри Passage, поэтому сам по себе
// не уникален — комбинируем с sid и passage.
export function taskRowKey(r: Pick<TaskRow, 'sid' | 'passage' | 'taskIdx'>): string {
  return `${r.sid}|${r.passage}|${r.taskIdx}`;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// normalizeAuditTaskPayload — из audit-payload task.executed (`status`, есть
// plan_index и error.message) в TaskRow.
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
  if (p.suppressed === 'no_log') row.suppressed = 'no_log';
  const err = p.error;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    row.errorCode = asString(e.code);
    row.errorModule = asString(e.module);
    // error.message осознанно НЕ переносим (секрет-гигиена — не рендерится).
  }
  return row;
}

export function sortTaskRows(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort(
    (a, b) => a.passage - b.passage || a.taskIdx - b.taskIdx || a.sid.localeCompare(b.sid),
  );
}
