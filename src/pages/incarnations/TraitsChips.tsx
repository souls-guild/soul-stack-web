// Read-only отображение incarnation.traits (ADR-060) — companion к TraitsEditor
// (write-виджет). Ключ → scalar | list of scalars; list-значения раскрываются
// через запятую внутри одного чипа. maxVisible ограничивает число видимых
// ключей, остальное сворачивается в чип «+N».

import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/primitives';

export type TraitsValue = Record<string, unknown> | null | undefined;

function formatTraitValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return String(v);
}

interface Props {
  traits: TraitsValue;
  maxVisible?: number;
  emptyFallback?: string;
}

/** Компактный набор чипов `key=value` из incarnation.traits. */
export function TraitsChips({ traits, maxVisible = Infinity, emptyFallback = '—' }: Props) {
  const { t } = useTranslation();
  const entries = traits && typeof traits === 'object' ? Object.entries(traits) : [];

  if (entries.length === 0) {
    return <span style={{ color: 'var(--text-faint)' }}>{emptyFallback}</span>;
  }

  const visible = entries.slice(0, maxVisible);
  const hiddenCount = entries.length - visible.length;

  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {visible.map(([key, val]) => (
        <Badge key={key} tone="info" title={`${key}=${formatTraitValue(val)}`}>
          {key}={formatTraitValue(val)}
        </Badge>
      ))}
      {hiddenCount > 0 ? (
        <Badge tone="muted" title={entries.slice(maxVisible).map(([k, v]) => `${k}=${formatTraitValue(v)}`).join(', ')}>
          {t('incarnations:traitsMoreCount', { count: hiddenCount })}
        </Badge>
      ) : null}
    </span>
  );
}
