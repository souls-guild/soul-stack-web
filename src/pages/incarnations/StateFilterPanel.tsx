// Динамическая панель фильтрации по state-полям incarnation.
//
// Список полей берётся из state_schema сервиса через getStateSchema() + extractFields().
// Операторы фиксированы контрактом API (eq/ne/gt/gte/lt/lte) — это протокол, не данные.
// Числовые типы (integer, number) поддерживают полный набор op; строки — eq/ne; bool/enum — eq/ne.
// Несколько предикатов объединяются по AND.
// Ошибка 422 от backend (нечисло в numeric-op) — отображается per-field, не краш.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { keeperApi, type StateFilterPredicate } from '../../api/keeper';
import { extractFields, isSchemaDegraded } from './stateSchema';
import { Button } from '../../components/primitives';

// Набор операторов по типу поля. Контракт API — не данные с backend.
const NUMERIC_OPS: StateFilterPredicate['op'][] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
const STRING_OPS: StateFilterPredicate['op'][] = ['eq', 'ne'];

function isNumericType(type: string): boolean {
  return type === 'integer' || type === 'number';
}

function opsForType(type: string): StateFilterPredicate['op'][] {
  return isNumericType(type) ? NUMERIC_OPS : STRING_OPS;
}

export interface StateFilterPanelProps {
  serviceName: string;
  predicates: StateFilterPredicate[];
  // per-field ошибки от backend (key = field имя, value = сообщение)
  fieldErrors: Record<string, string>;
  onChange: (predicates: StateFilterPredicate[]) => void;
}

export function StateFilterPanel({ serviceName, predicates, fieldErrors, onChange }: StateFilterPanelProps) {
  const { t } = useTranslation();

  const schemaQ = useQuery({
    queryKey: ['stateSchema', serviceName],
    queryFn: () => keeperApi.services.getStateSchema(serviceName),
    enabled: Boolean(serviceName),
    retry: false,
  });

  const fields = useMemo(
    () => (schemaQ.data ? extractFields(schemaQ.data.schema as Record<string, unknown> | undefined) : null),
    [schemaQ.data],
  );

  // Схема загружается, или деградировала (404/501/502) — скрываем панель.
  if (schemaQ.isLoading) {
    return (
      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        {t('incarnations:loadSchema')}
      </div>
    );
  }
  if (schemaQ.error && isSchemaDegraded(schemaQ.error)) {
    return (
      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        {t('incarnations:stateFilterSchemaUnavailable')}
      </div>
    );
  }
  // Схема доступна, но поля не задекларированы — ничего не показываем.
  if (!fields || fields.length === 0) {
    return (
      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        {t('incarnations:stateFilterNoFields')}
      </div>
    );
  }

  function addPredicate() {
    const first = fields![0];
    const defaultOp = opsForType(first.type)[0];
    onChange([...predicates, { field: first.name, op: defaultOp, value: '' }]);
  }

  function removePredicate(idx: number) {
    onChange(predicates.filter((_, i) => i !== idx));
  }

  function updatePredicate(idx: number, patch: Partial<StateFilterPredicate>) {
    const next = predicates.map((p, i) => {
      if (i !== idx) return p;
      const updated = { ...p, ...patch };
      // При смене поля — сброс op на первый доступный для нового типа.
      if ('field' in patch) {
        const fieldDef = fields!.find((f) => f.name === updated.field);
        const availOps = opsForType(fieldDef?.type ?? 'string');
        if (!availOps.includes(updated.op)) {
          updated.op = availOps[0];
        }
      }
      return updated;
    });
    onChange(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {predicates.map((pred, idx) => {
        const fieldDef = fields.find((f) => f.name === pred.field);
        const availOps = opsForType(fieldDef?.type ?? 'string');
        const fieldError = fieldErrors[pred.field];
        const isNumeric = isNumericType(fieldDef?.type ?? 'string');

        return (
          <div
            key={idx}
            style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}
          >
            {/* Выбор поля из схемы */}
            <select
              aria-label={t('incarnations:stateFilterField')}
              value={pred.field}
              onChange={(e) => updatePredicate(idx, { field: e.target.value })}
              style={{
                padding: '6px 8px',
                borderRadius: 'var(--radius)',
                border: `1px solid ${fieldError ? 'var(--danger)' : 'var(--border)'}`,
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
              }}
            >
              {fields.map((f) => (
                <option key={f.name} value={f.name} title={f.type}>
                  {f.name}
                </option>
              ))}
            </select>

            {/* Оператор */}
            <select
              aria-label={t('incarnations:stateFilterOp')}
              value={pred.op}
              onChange={(e) => updatePredicate(idx, { op: e.target.value as StateFilterPredicate['op'] })}
              style={{
                padding: '6px 8px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: 12.5,
              }}
            >
              {availOps.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>

            {/* Значение */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <input
                type={isNumeric ? 'number' : 'text'}
                aria-label={t('incarnations:stateFilterValue')}
                value={pred.value}
                onChange={(e) => updatePredicate(idx, { value: e.target.value })}
                aria-invalid={fieldError ? 'true' : undefined}
                placeholder={isNumeric ? '0' : '"value"'}
                style={{
                  padding: '6px 8px',
                  borderRadius: 'var(--radius)',
                  border: `1px solid ${fieldError ? 'var(--danger)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                  width: 120,
                }}
              />
              {fieldError ? (
                <span style={{ color: 'var(--danger)', fontSize: 11 }}>{fieldError}</span>
              ) : null}
            </div>

            {/* Удалить предикат */}
            <button
              type="button"
              aria-label={t('incarnations:stateFilterRemove')}
              onClick={() => removePredicate(idx)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '6px 4px',
                lineHeight: 1,
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      <div>
        <Button type="button" variant="ghost" onClick={addPredicate}>
          <Plus size={12} /> {t('incarnations:stateFilterAdd')}
        </Button>
      </div>
    </div>
  );
}
