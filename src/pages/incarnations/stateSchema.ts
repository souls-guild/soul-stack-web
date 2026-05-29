// Хелперы state_schema-таба: вытаскивание плоского списка полей из MVP-подмножества
// JSON Schema + классификация degraded-ошибки endpoint-а. Вынесено из SchemaTab.tsx
// (react-refresh: в файле-компоненте — только компоненты), переиспользуется
// SchemaTab (incarnation) и ServiceSchemaTab (service).

import { ApiError } from '../../api/client';

// MVP-подмножество JSON Schema: плоский список top-level-полей (имя + type +
// required). Вложенные object/array показываются типом как есть; глубокий
// рекурсивный рендер не делаем.
export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
}

export function extractFields(schema: Record<string, unknown> | undefined): SchemaField[] | null {
  if (!schema || typeof schema !== 'object') return null;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const requiredRaw = (schema as Record<string, unknown>).required;
  const required = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === 'string') : [],
  );
  const out: SchemaField[] = [];
  for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
    let type = '—';
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const t = (def as Record<string, unknown>).type;
      if (typeof t === 'string') type = t;
      else if (Array.isArray(t)) type = t.map(String).join(' | ');
    }
    out.push({ name, type, required: required.has(name) });
  }
  return out;
}

// 404 (endpoint/service нет), 501 (не реализован), 502 (loader не достал репо) —
// деградируем к placeholder-у. Прочие ошибки показываем как errorBox.
export function isSchemaDegraded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 502);
}
