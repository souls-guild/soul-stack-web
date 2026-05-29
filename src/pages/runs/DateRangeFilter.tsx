import { useTranslation } from 'react-i18next';
import { hasDateRange, type DateRange } from './dateRange';

// Два date-input (от/до по started_at) + очистка. Клиентский фильтр поверх
// загруженной страницы (см. dateRange.ts) — общий контрол для /runs и Command
// runs. `metaKeyClass` пробрасывается, чтобы лейбл совпал с соседними фильтрами.

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
  metaKeyClass: string;
}

export function DateRangeFilter({ value, onChange, metaKeyClass }: Props) {
  const { t } = useTranslation();
  return (
    <div>
      <div className={metaKeyClass}>{t('runhistory:filterDateRangeLabel')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <input
          type="date"
          aria-label={t('runhistory:filterDateFromLabel')}
          data-testid="date-from"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          style={dateInputStyle}
        />
        <span style={{ color: 'var(--text-muted)' }}>—</span>
        <input
          type="date"
          aria-label={t('runhistory:filterDateToLabel')}
          data-testid="date-to"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          style={dateInputStyle}
        />
        {hasDateRange(value) ? (
          <button
            type="button"
            data-testid="date-clear"
            onClick={() => onChange({ from: '', to: '' })}
            style={clearStyle}
          >
            {t('runhistory:filterDateClear')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const dateInputStyle = {
  padding: '6px 8px',
  fontSize: 12.5,
  fontFamily: 'var(--font-mono)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
} as const;

const clearStyle = {
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
} as const;
