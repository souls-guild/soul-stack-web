import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunTaskParamCell, RunTaskParamVariant, RunTaskParamsByHost } from '../../api/keeper';
import { hostText, paramValue } from './runTaskParams';
import styles from './RunTasks.module.css';

// "Input by host" (NIM-985): shown INSTEAD of the params panel when a task's input
// differs between hosts. Every leaf of the input → the values it took → the hosts
// that took each. The keeper builds the cells from masked data only.

export type HostFilter = { label: string; sids: string[] };

// A value list longer than this shows its first entries, a "N more" toggle and a search.
const VISIBLE_VALUES = 6;
// More shared leaves than this collapse into one line, shown on demand.
const VISIBLE_SAME = 5;
// SIDs are written into the value chip up to this many hosts; past it, a count.
const INLINE_SIDS = 3;
const MAX_VALUE_CHARS = 80;

function truncate(s: string): string {
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s;
}

type Row =
  | { kind: 'cell'; cell: RunTaskParamCell }
  | { kind: 'text'; path: string; hunks: RunTaskParamCell[]; base: string[] };

function buildRows(data: RunTaskParamsByHost): Row[] {
  const bases = new Map((data.texts ?? []).map((tx) => [tx.path, tx.lines ?? []]));
  const rows: Row[] = [];
  const texts = new Map<string, Extract<Row, { kind: 'text' }>>();
  for (const cell of data.cells ?? []) {
    if (!cell.line) {
      rows.push({ kind: 'cell', cell });
      continue;
    }
    let row = texts.get(cell.path);
    if (!row) {
      row = { kind: 'text', path: cell.path, hunks: [], base: bases.get(cell.path) ?? [] };
      texts.set(cell.path, row);
      rows.push(row);
    }
    row.hunks.push(cell);
  }
  return rows;
}

export function ParamsByHostPanel({
  data,
  onFilter,
}: {
  data: RunTaskParamsByHost;
  onFilter: (f: HostFilter) => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildRows(data), [data]);
  const sameRows = rows.filter((r) => r.kind === 'cell' && r.cell.same);
  const collapsible = sameRows.length > VISIBLE_SAME;
  const [showSame, setShowSame] = useState(false);
  const hideSame = collapsible && !showSame;

  return (
    <>
      <div className={styles.blabel}>
        {t('runhistory:runTasksInputByHostTitle')}{' '}
        <span className={styles.differs}>{t('runhistory:runTasksInputDiffers')}</span>{' '}
        <span className={styles.hostCount}>{t('runhistory:runTasksHostCount', { count: data.hosts })}</span>
      </div>
      <div className={styles.pbh} data-testid="run-task-params-by-host">
        {rows.map((row, i) =>
          row.kind === 'text' ? (
            <TextRows key={`${i}:text:${row.path}`} row={row} onFilter={onFilter} />
          ) : hideSame && row.cell.same ? null : (
            <div key={`${i}:cell:${row.cell.path}`} style={{ display: 'contents' }} data-testid={`run-task-pbh-row-${row.cell.path}`}>
              <span className={styles.kvKey}>{row.cell.path}</span>
              <Values cell={row.cell} hosts={data.hosts} isHunk={false} filterKey={row.cell.path} onFilter={onFilter} />
            </div>
          ),
        )}
        {collapsible ? (
          <div className={styles.sameNote} data-testid="run-task-pbh-same-toggle">
            {hideSame
              ? t('runhistory:runTasksSameHidden', {
                  count: sameRows.length,
                  keys: sameRows.map((r) => (r.kind === 'cell' ? r.cell.path : '')).join(', '),
                })
              : null}{' '}
            <button type="button" className={styles.linkBtn} onClick={() => setShowSame((s) => !s)}>
              {hideSame ? t('runhistory:runTasksShow') : t('runhistory:runTasksHideSame')}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function lineLabel(t: (k: string, o?: Record<string, unknown>) => string, cell: RunTaskParamCell, baseLen: number): string {
  const line = cell.line ?? 1;
  const count = cell.line_count ?? 0;
  if (count === 0) {
    return line > baseLen
      ? t('runhistory:runTasksAfterLine', { line: baseLen })
      : t('runhistory:runTasksBeforeLine', { line });
  }
  if (count === 1) return t('runhistory:runTasksLine', { line });
  return t('runhistory:runTasksLines', { from: line, to: line + count - 1 });
}

function TextRows({ row, onFilter }: { row: Extract<Row, { kind: 'text' }>; onFilter: (f: HostFilter) => void }) {
  const { t } = useTranslation();
  const [sid, setSid] = useState('');
  const sids = useMemo(
    () => [...new Set((row.hunks[0]?.values ?? []).flatMap((v) => v.sids ?? []))].sort(),
    [row.hunks],
  );
  const differing = row.hunks.reduce((n, h) => n + (h.line_count ?? 0), 0);
  const text = sid ? hostText(row.base, row.hunks, sid) : null;

  return (
    <>
      <span className={styles.kvKey} data-testid={`run-task-pbh-row-${row.path}`}>
        {row.path}
      </span>
      <span className={styles.textHead}>
        {t('runhistory:runTasksTextSummary', { lines: row.base.length, same: row.base.length - differing })}
        <label className={styles.textPick}>
          {t('runhistory:runTasksHostText')}{' '}
          <select value={sid} onChange={(e) => setSid(e.target.value)} data-testid={`run-task-pbh-host-text-${row.path}`}>
            <option value="">—</option>
            {sids.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </span>
      {row.hunks.map((h) => (
        <div key={`${row.path}:${h.line}:${h.line_count ?? 0}`} style={{ display: 'contents' }}>
          <span className={`${styles.kvKey} ${styles.lineKey}`}>{lineLabel(t, h, row.base.length)}</span>
          <Values
            cell={h}
            hosts={sids.length}
            isHunk
            filterKey={`${row.path} ${lineLabel(t, h, row.base.length)}`}
            onFilter={onFilter}
          />
        </div>
      ))}
      {text ? (
        <pre className={styles.hostTextPre} data-testid={`run-task-pbh-text-${row.path}`}>
          {text.join('\n')}
        </pre>
      ) : null}
    </>
  );
}

function Values({
  cell,
  hosts,
  isHunk,
  filterKey,
  onFilter,
}: {
  cell: RunTaskParamCell;
  hosts: number;
  isHunk: boolean;
  filterKey: string;
  onFilter: (f: HostFilter) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const values = cell.values ?? [];

  const label = (v: RunTaskParamVariant): string => {
    if (v.absent) return isHunk ? t('runhistory:runTasksAbsentLine') : t('runhistory:runTasksAbsentKey');
    if (v.lines) {
      const first = v.lines[0] ? v.lines[0] : t('runhistory:runTasksEmptyLine');
      const more = v.lines.length - 1;
      return more > 0 ? `${first} ${t('runhistory:runTasksMoreLines', { count: more })}` : first;
    }
    return paramValue(v.value);
  };
  const full = (v: RunTaskParamVariant): string => (v.lines ? v.lines.join('\n') : label(v));

  if (cell.same) {
    const v = values[0] ?? {};
    return (
      <span className={styles.vals}>
        <span className={`${styles.chip} ${styles.chipSame}`} title={full(v)}>
          <b>{truncate(label(v))}</b>
          <span className={styles.chipN}>{t('runhistory:runTasksAllHosts', { count: hosts })}</span>
        </span>
      </span>
    );
  }

  const top = values[0]?.sids?.length ?? 0;
  const unique = values.length > 1 && values.every((v) => (v.sids ?? []).length === 1);
  const q = query.trim().toLowerCase();
  const shown = q
    ? values.filter((v) => full(v).toLowerCase().includes(q) || (v.sids ?? []).some((s) => s.toLowerCase().includes(q)))
    : expanded
      ? values
      : values.slice(0, VISIBLE_VALUES);
  const long = values.length > VISIBLE_VALUES;

  return (
    <span className={styles.vals}>
      {unique ? <span className={styles.uniq}>{t('runhistory:runTasksOwnPerHost')}</span> : null}
      {shown.map((v, i) => {
        const sids = v.sids ?? [];
        const rare = i > 0 && sids.length < top;
        return (
          <button
            type="button"
            key={`${sids[0] ?? i}`}
            className={`${styles.chip} ${rare || v.absent ? styles.chipRare : ''} ${v.absent ? styles.chipAbsent : ''}`}
            title={full(v)}
            onClick={() => onFilter({ label: `${filterKey} = ${truncate(label(v))}`, sids })}
            data-testid="run-task-pbh-value"
          >
            <b>{truncate(label(v))}</b>
            <span className={styles.chipN}>{sids.length <= INLINE_SIDS ? sids.join(', ') : sids.length}</span>
          </button>
        );
      })}
      {long && !q ? (
        <button type="button" className={styles.linkBtn} onClick={() => setExpanded((e) => !e)}>
          {expanded ? t('runhistory:runTasksHideValues') : t('runhistory:runTasksMoreValues', { count: values.length - VISIBLE_VALUES })}
        </button>
      ) : null}
      {long ? (
        <input
          className={styles.find}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('runhistory:runTasksFindValue')}
          aria-label={t('runhistory:runTasksFindValue')}
          data-testid="run-task-pbh-find"
        />
      ) : null}
    </span>
  );
}
