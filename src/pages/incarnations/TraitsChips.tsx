// Read-only display of incarnation.traits (ADR-060) — companion to TraitsEditor
// (write widget). Key -> scalar | list of scalars; list values are expanded
// with a comma inside one chip. maxVisible limits the number of visible
// keys, the rest collapses into a "+N" chip.

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

/** Compact set of `key=value` chips from incarnation.traits. */
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
