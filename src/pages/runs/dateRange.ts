// КЛИЕНТСКИЙ фильтр по диапазону дат для списков прогонов (НЕ серверный).
//
// Backend на момент написания не отдаёт единого диапазона started_at для всех
// run-эндпоинтов: errands/errand-runs принимают только `started_after` (нижняя
// граница, без верхней), а tides/push-runs — вообще без дат-параметров. Поэтому
// диапазон применяется на клиенте поверх УЖЕ ЗАГРУЖЕННОЙ страницы (LIMIT-выборки),
// а не транслируется в query. Для полноценного серверного диапазона нужен
// backend-параметр `started_after`/`started_before` на всех list-эндпоинтах —
// заведено отдельной задачей на core.
//
// Контракт инпутов — `<input type="date">` (значение `YYYY-MM-DD` в локальной
// зоне, либо ''). `from` включает с начала дня, `to` — по конец дня (обе границы
// включающие). Невалидный/пустой ts строки в выборку при заданном диапазоне НЕ
// попадает (нечего сравнивать).

export interface DateRange {
  from: string; // 'YYYY-MM-DD' | ''
  to: string; // 'YYYY-MM-DD' | ''
}

export const EMPTY_DATE_RANGE: DateRange = { from: '', to: '' };

export function hasDateRange(r: DateRange): boolean {
  return r.from !== '' || r.to !== '';
}

// from → начало дня (00:00:00.000), to → конец дня (23:59:59.999), локальная
// зона. Невалидная дата → null (граница игнорируется).
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

// Предикат «ts попадает в диапазон». Пустой диапазон → всегда true.
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

// СЕРВЕРНЫЙ диапазон started_at: локальные даты from/to → ISO-границы
// (from → начало дня → started_after; to → конец дня → started_before).
// Пустая/невалидная граница → поле опущено.
export function toServerRange(r: DateRange): { started_after?: string; started_before?: string } {
  const out: { started_after?: string; started_before?: string } = {};
  const lo = dayStart(r.from);
  if (lo !== null) out.started_after = new Date(lo).toISOString();
  const hi = dayEnd(r.to);
  if (hi !== null) out.started_before = new Date(hi).toISOString();
  return out;
}
