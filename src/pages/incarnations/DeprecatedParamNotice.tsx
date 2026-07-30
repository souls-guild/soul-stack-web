import { useTranslation } from 'react-i18next';
import type { ModuleDeprecation } from '../../api/keeper';
import { Badge } from '../../components/primitives';

// NIM-243: a module parameter the manifest still honors but that is on its way
// out. This is a warning, never a gate: the field keeps its input, keeps its
// value and is still submitted. Once `removed_in` lands the parameter leaves
// the manifest on its own and the backend rejects it as an unknown_param.
//
// All three sub-keys of the block are optional in the wire schema. The manifest
// validator does demand since+removed_in, but nothing between it and this
// component enforces that, so each bound has its own sentence — a missing one
// shortens the phrase instead of rendering the word "undefined".

interface Props {
  name: string;
  deprecated: ModuleDeprecation;
  // Present only when successorSwap found the move safe; absent leaves the
  // suggestion purely textual.
  onSwitch?: () => void;
}

export function DeprecatedParamNotice({ name, deprecated, onSwitch }: Props) {
  const { t } = useTranslation();
  const since = deprecated.since;
  const removedIn = deprecated.removed_in;
  const use = deprecated.use;

  const sentence = since && removedIn
    ? t('run:paramDeprecatedFull', { since, removedIn })
    : since
      ? t('run:paramDeprecatedSince', { since })
      : removedIn
        ? t('run:paramDeprecatedUntil', { removedIn })
        : t('run:paramDeprecatedBare');

  return (
    <div
      role="note"
      data-testid={`field-deprecated-${name}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--text-muted)',
      }}
    >
      <Badge tone="warn">{t('run:paramDeprecatedBadge')}</Badge>
      <span>{sentence}</span>
      {use ? (
        <span data-testid={`field-deprecated-use-${name}`}>
          {t('run:paramDeprecatedUse', { name: use })}
        </span>
      ) : null}
      {use && onSwitch ? (
        <button
          type="button"
          onClick={onSwitch}
          data-testid={`field-deprecated-switch-${name}`}
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {t('run:paramDeprecatedSwitch', { name: use })}
        </button>
      ) : null}
    </div>
  );
}
