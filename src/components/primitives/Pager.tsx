import { useTranslation } from 'react-i18next';

interface Props {
  offset: number;
  limit: number;
  total: number;
  // Сколько элементов реально отрисовано на текущей странице (items.length).
  shown: number;
  onChange: (offset: number) => void;
}

// Общий пагинатор offset/limit. Раньше этот блок копировался инлайном в каждом
// списке (Archons / Errands / ErrandRuns / Tides / PushRuns); вынесен сюда,
// чтобы перевод prev/next/range жил в одном месте.
export function Pager({ offset, limit, total, shown, onChange }: Props) {
  const { t } = useTranslation();
  const atStart = offset === 0;
  const atEnd = offset + limit >= total;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
      <button disabled={atStart} onClick={() => onChange(Math.max(0, offset - limit))} style={btnStyle(atStart)}>
        {t('prev')}
      </button>
      <span>{t('paginationRange', { from: offset + 1, to: offset + shown, total })}</span>
      <button disabled={atEnd} onClick={() => onChange(offset + limit)} style={btnStyle(atEnd)}>
        {t('next')}
      </button>
    </div>
  );
}

function btnStyle(disabled: boolean) {
  return {
    padding: '4px 10px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
  } as const;
}
