import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type VoyageTargetEntry, type VoyageTargetStatus } from '../../api/keeper';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';

// satisfies: enum is a subset of VoyageTargetStatus; extending the backend will require tsc to be revisited.
const _ALL_TARGET_STATUSES = [
  'awaiting',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'no_match',
] as const satisfies readonly VoyageTargetStatus[];
void _ALL_TARGET_STATUSES; // lint: used for type-check only

interface Props {
  voyageId: string;
  /** Refetch interval: passed from VoyageDetail (3000 while voyage is running, otherwise false). */
  refetchInterval: number | false;
  /** Active status filter. null = all. */
  statusFilter?: string | null;
}

export function VoyageTargets({ voyageId, refetchInterval, statusFilter }: Props) {
  const { t } = useTranslation('runhistory');

  const q = useQuery({
    queryKey: ['voyage.targets', voyageId],
    queryFn: () => keeperApi.voyages.targets(voyageId),
    enabled: Boolean(voyageId),
    refetchInterval,
  });

  if (q.isLoading && !q.data) {
    return <div className={styles.loading}>{t('voyageTargetsLoading')}</div>;
  }

  const allTargets = q.data?.targets ?? [];
  const targets = statusFilter
    ? allTargets.filter((e) => e.status === statusFilter)
    : allTargets;

  if (allTargets.length === 0) {
    return <div className={styles.empty}>{t('voyageTargetsEmpty')}</div>;
  }

  if (statusFilter && targets.length === 0) {
    return <div className={styles.empty}>{t('voyageTargetsNoneForStatus', { status: statusFilter })}</div>;
  }

  // Group by batch_index (sort indices for predictable order).
  const grouped = groupByBatchIndex(targets);
  const sortedIndices = [...grouped.keys()].sort((a, b) => a - b);

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>{t('voyageTargetsColTarget')}</th>
          <th style={thStyle}>{t('voyageTargetsColStatus')}</th>
          <th style={thStyle}>{t('voyageTargetsColFinishedAt')}</th>
          <th style={thStyle}>{t('voyageTargetsColApplyId')}</th>
        </tr>
      </thead>
      <tbody>
        {sortedIndices.map((batchIdx) => (
          <React.Fragment key={batchIdx}>
            <tr>
              <td
                colSpan={4}
                data-testid={`batch-heading-${batchIdx}`}
                style={batchSepStyle}
              >
                {t('voyageTargetsBatchHeading', { index: batchIdx })}
              </td>
            </tr>
            {(grouped.get(batchIdx) ?? []).map((entry) => (
              <tr key={`${entry.target_kind}:${entry.target_id}`}>
                <td style={tdStyle}>
                  {/* incarnation-target -> link to detail; soul-target -> link to soul */}
                  {entry.target_kind === 'incarnation' ? (
                    <Link
                      to={`/incarnations/${encodeURIComponent(entry.target_id)}`}
                      className="mono"
                      style={{ fontSize: 13 }}
                    >
                      {entry.target_id}
                    </Link>
                  ) : entry.target_kind === 'soul' ? (
                    <KeeperSidCell
                      sid={entry.target_id}
                      className="mono"
                      style={{ fontSize: 13 }}
                    />
                  ) : (
                    <span className="mono" style={{ fontSize: 13 }}>
                      {entry.target_id}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  <Badge tone={runStatusTone(entry.status)}>{entry.status}</Badge>
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {entry.finished_at ?? '—'}
                </td>
                <td style={tdStyle}>
                  {/* apply_id = voyage_id of this step. Links to /voyages/:id */}
                  {entry.apply_id ? (
                    <Link
                      to={`/voyages/${encodeURIComponent(entry.apply_id)}`}
                      className="mono"
                      style={{ fontSize: 12 }}
                      title={t('voyageTargetsApplyIdLink')}
                      data-testid={`target-apply-link-${entry.target_id}`}
                    >
                      {entry.apply_id.slice(0, 12)}…
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function groupByBatchIndex(targets: VoyageTargetEntry[]): Map<number, VoyageTargetEntry[]> {
  const map = new Map<number, VoyageTargetEntry[]>();
  for (const entry of targets) {
    const list = map.get(entry.batch_index);
    if (list) {
      list.push(entry);
    } else {
      map.set(entry.batch_index, [entry]);
    }
  }
  return map;
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  tableLayout: 'fixed',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  fontWeight: 500,
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border)',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 8px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const batchSepStyle: React.CSSProperties = {
  padding: '10px 8px 4px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: 'var(--surface-2)',
  borderBottom: '1px solid var(--border)',
};
