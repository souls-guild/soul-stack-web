import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/primitives';
import type { RunFailure } from '../../api/keeper';
import { causeText, failedTask, hasAddress, sourceAt } from './runFailure';
import styles from '../common.module.css';

// The run's failure as a row of the failures block (NIM-1000): where on top, what below,
// the full text under a disclosure. foldSummary — the hosts' rows below already report
// what a text-only failure would repeat in one long line.
export function RunFailureRow({ failure, foldSummary = false }: { failure: RunFailure; foldSummary?: boolean }) {
  const { t } = useTranslation();
  const tasks = failure.tasks ?? [];
  const task = failedTask(failure);
  const source = sourceAt(task?.file, task?.line);
  const via = (task?.included_from ?? []).map((s) => sourceAt(s.file, s.line)).filter(Boolean);
  const addressed = hasAddress(failure);

  return (
    <div className={styles.errorBox} style={{ marginBottom: 8 }} data-testid="run-failure">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {t('runhistory:runFailureRun')}{' '}
        {failure.code ? <Badge tone="danger">{failure.code}</Badge> : null}
      </div>
      <div data-testid="run-failure-where">
        {failure.step != null ? <span>{t('runhistory:runFailureStep', { step: failure.step })}</span> : null}
        {tasks.map((tk, i) => (
          <span key={`${tk.index ?? 'x'}-${i}`}>
            {failure.step != null || i > 0 ? ' › ' : null}
            <b>
              {tk.index != null ? `#${tk.index} ` : ''}
              {tk.name}
            </b>
            {tk.destiny ? <span className="mono"> ({tk.destiny})</span> : null}
          </span>
        ))}
        {source ? (
          <>
            {' · '}
            <span className="mono" data-testid="run-failure-source">
              {source}
            </span>
          </>
        ) : null}
        {via.length > 0 ? (
          <span style={{ color: 'var(--text-muted)' }}> ({t('runhistory:runFailureIncludedFrom', { at: via.join(' › ') })})</span>
        ) : null}
        {failure.host ? (
          <>
            {' · '}
            {t('runhistory:runFailureOnHost')} <span className="mono">{failure.host}</span>
          </>
        ) : null}
      </div>
      {addressed ? (
        <div className="mono" style={{ marginTop: 4 }} data-testid="run-failure-cause">
          {failure.cell ? `${failure.cell} · ` : ''}
          {failure.expression ? `${failure.expression} → ` : ''}
          {failure.cause_withheld ? <i style={{ fontFamily: 'var(--font-sans)' }}>{causeText(failure, t)}</i> : causeText(failure, t)}
        </div>
      ) : null}
      {failure.summary && (addressed || foldSummary) ? (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>{t('runhistory:runFailureFullText')}</summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }} data-testid="run-failure-summary">
            {failure.summary}
          </pre>
        </details>
      ) : null}
      {failure.summary && !addressed && !foldSummary ? (
        <div className="mono" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }} data-testid="run-failure-summary">
          {failure.summary}
        </div>
      ) : null}
    </div>
  );
}
