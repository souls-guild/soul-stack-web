// Client-side мультиселект-фильтр coven + traits поверх уже загруженного набора
// инкарнаций (нет server-side каталога/фильтра traits — ADR-042 не хардкодим
// каталог, вычисляем опции из фактически подгруженных строк). Комбинация двух
// селектов работает по AND: выбранный coven ⊆ item.covens И выбранная
// trait-пара присутствует в item.traits (несколько traits-выборов — тоже AND).
// Чистые функции — в ./covenTraitsFilter.helpers (react-refresh не позволяет
// смешивать non-component экспорты с компонентом в одном файле).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IncarnationGetReply } from '../../api/keeper';
import {
  collectCovenOptions,
  collectTraitOptions,
  EMPTY_COVEN_TRAITS_FILTER,
  type CovenTraitsFilterValue,
} from './covenTraitsFilter.helpers';

interface Props {
  items: IncarnationGetReply[];
  value: CovenTraitsFilterValue;
  onChange: (next: CovenTraitsFilterValue) => void;
}

/** Мультиселект coven + traits (client-side, AND), опции — из подгруженного набора. */
export function CovenTraitsFilter({ items, value, onChange }: Props) {
  const { t } = useTranslation();

  const covenOptions = useMemo(() => collectCovenOptions(items), [items]);
  const traitOptions = useMemo(() => collectTraitOptions(items), [items]);

  function toggleCoven(c: string) {
    const next = value.covens.includes(c)
      ? value.covens.filter((x) => x !== c)
      : [...value.covens, c];
    onChange({ ...value, covens: next });
  }

  function toggleTrait(pair: string) {
    const next = value.traits.includes(pair)
      ? value.traits.filter((x) => x !== pair)
      : [...value.traits, pair];
    onChange({ ...value, traits: next });
  }

  const hasSelection = value.covens.length > 0 || value.traits.length > 0;

  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 9px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${active ? 'var(--accent, var(--text))' : 'var(--border)'}`,
    background: active ? 'var(--surface-2)' : 'var(--surface)',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          {t('incarnations:filterCovenMulti')}
        </div>
        {covenOptions.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('incarnations:filterCovenMultiEmpty')}</span>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {covenOptions.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={value.covens.includes(c)}
                onClick={() => toggleCoven(c)}
                style={chipStyle(value.covens.includes(c))}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          {t('incarnations:filterTraitsMulti')}
        </div>
        {traitOptions.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('incarnations:filterTraitsMultiEmpty')}</span>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {traitOptions.map((pair) => (
              <button
                key={pair}
                type="button"
                aria-pressed={value.traits.includes(pair)}
                onClick={() => toggleTrait(pair)}
                style={chipStyle(value.traits.includes(pair))}
              >
                {pair}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasSelection ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_COVEN_TRAITS_FILTER)}
          style={{
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            textDecoration: 'underline',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {t('incarnations:filterClearAll')}
        </button>
      ) : null}
    </div>
  );
}
