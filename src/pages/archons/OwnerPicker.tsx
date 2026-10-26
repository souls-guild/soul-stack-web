// The owner of a machine operator: a person (an active Archon that signs in
// itself, searched on the server) or a Synod (GET /v1/synods). Controlled: the
// parent holds kind and value — the create form and the "Change owner" modal.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type Operator } from '../../api/keeper';
import { SearchMultiSelect } from '../../components/primitives';
import { OWNER_AUTH_METHODS, type OwnerKind } from './owner';

interface Props {
  kind: OwnerKind | '';
  value: string;
  onKindChange: (kind: OwnerKind | '') => void;
  onValueChange: (value: string) => void;
  allowNone?: boolean;
  enabled?: boolean;
  error?: string;
  testidPrefix: string;
}

export function OwnerPicker({
  kind,
  value,
  onKindChange,
  onValueChange,
  allowNone,
  enabled = true,
  error,
  testidPrefix,
}: Props) {
  const { t } = useTranslation();
  const synodsQ = useQuery({
    queryKey: ['synods'],
    queryFn: () => keeperApi.synods.list(),
    enabled: enabled && kind === 'synod',
    staleTime: 30_000,
  });
  const kinds: { id: OwnerKind | ''; labelKey: string }[] = [
    ...(allowNone ? [{ id: '' as const, labelKey: 'pages:archonOwnerKindNone' }] : []),
    { id: 'archon', labelKey: 'pages:archonOwnerKindArchon' },
    { id: 'synod', labelKey: 'pages:archonOwnerKindSynod' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
      <div
        role="radiogroup"
        aria-label={t('pages:archonOwnerKindAria')}
        data-testid={`${testidPrefix}-kind`}
        style={{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}
      >
        {kinds.map((k) => (
          <button
            key={k.id || 'none'}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            data-testid={`${testidPrefix}-kind-${k.id || 'none'}`}
            onClick={() => {
              if (k.id !== kind) {
                onKindChange(k.id);
                onValueChange('');
              }
            }}
            style={{
              padding: '4px 10px',
              border: 0,
              borderRight: '1px solid var(--border)',
              background: kind === k.id ? 'var(--surface-2)' : 'var(--surface)',
              color: kind === k.id ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: kind === k.id ? 600 : 400,
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            {t(k.labelKey)}
          </button>
        ))}
      </div>

      {kind === 'archon' ? (
        <SearchMultiSelect<Operator>
          search={(q) =>
            keeperApi.operators
              .list({ q })
              .then((r) =>
                (r.items ?? []).filter(
                  (op) => !op.revoked_at && OWNER_AUTH_METHODS.includes(op.auth_method),
                ),
              )
          }
          queryKey={['operators.owner-search']}
          enabled={enabled}
          selected={value ? [value] : []}
          // One owner: a second pick replaces the first.
          onChange={(next) => onValueChange(next.at(-1) ?? '')}
          getKey={(op) => op.aid}
          getLabel={(op) => op.display_name || op.aid}
          getSublabel={(op) => `${op.aid} · ${op.auth_method}`}
          placeholder={t('pages:archonOwnerSearchPlaceholder')}
          emptyText={t('pages:archonOwnerSearchEmpty')}
          testidPrefix={`${testidPrefix}-archon`}
        />
      ) : null}

      {kind === 'synod' ? (
        <select
          aria-label={t('pages:archonOwnerSynodAria')}
          data-testid={`${testidPrefix}-synod`}
          value={value}
          disabled={synodsQ.isLoading || Boolean(synodsQ.error)}
          onChange={(e) => onValueChange(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          <option value="">
            {synodsQ.error ? t('pages:archonOwnerSynodsUnavailable') : t('pages:archonOwnerSynodChoose')}
          </option>
          {(synodsQ.data?.items ?? []).map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}

      {error ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>
      ) : null}
    </div>
  );
}
