import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Plus, Play } from 'lucide-react';
import {
  keeperApi,
  type IncarnationGetReply,
  type IncarnationStatus,
  type StateFilterPredicate,
} from '../../api/keeper';
import { Badge, Button, Dot } from '../../components/primitives';
import { incarnationDot, incarnationTone } from '../../components/status';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import { StateFilterPanel } from './StateFilterPanel';
import { TraitsChips } from './TraitsChips';
import { CovenTraitsFilter } from './CovenTraitsFilter';
import {
  EMPTY_COVEN_TRAITS_FILTER,
  matchesCovenTraitsFilter,
  type CovenTraitsFilterValue,
} from './covenTraitsFilter.helpers';
import styles from '../common.module.css';

// satisfies гарантирует, что список ⊆ IncarnationStatus; tsc упадёт при добавлении нового статуса в backend
const INCARNATION_STATUSES = [
  'provisioning',
  'ready',
  'applying',
  'error_locked',
  'migration_failed',
  'drift',
  'destroying',
  'destroy_failed',
] as const satisfies readonly IncarnationStatus[];

const COVEN_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

type SortKey = 'created_at' | 'name' | 'status';
type SortDir = 'asc' | 'desc';

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const ago = i18n.t('incarnations:ago');
  if (deltaSec < 60) return `${deltaSec}s ${ago}`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ${ago}`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ${ago}`;
  return `${Math.floor(deltaSec / 86_400)}d ${ago}`;
}

// Экранирование regex-специальных символов (для snapshot-перехода в RunWizard).
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Строит incarnationRegex из набора имён (snapshot: OR из anchored-имён).
// Вызывается только когда canRunSet=true (items.length > 0), поэтому names гарантированно непуст.
function buildSnapshotRegex(names: string[]): string {
  if (names.length === 1) return `^${escapeRegex(names[0])}$`;
  return `^(${names.map(escapeRegex).join('|')})$`;
}

export function IncarnationsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState<string>('');
  const [status, setStatus] = useState<IncarnationStatus | ''>('');
  const [coven, setCoven] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // State-фильтры (динамические, из схемы сервиса).
  const [statePredicates, setStatePredicates] = useState<StateFilterPredicate[]>([]);
  // per-field ошибки 422 от backend.
  const [stateFieldErrors, setStateFieldErrors] = useState<Record<string, string>>({});

  // Client-side мультиселект coven+traits поверх уже загруженного набора
  // (нет server-side traits-фильтра/каталога; coven-фильтр выше — server-side
  // single exact-match, этот — доп. AND-слой для комбинации с traits).
  const [covenTraitsFilter, setCovenTraitsFilter] = useState<CovenTraitsFilterValue>(EMPTY_COVEN_TRAITS_FILTER);

  const trimmedCoven = coven.trim();
  const covenValid = trimmedCoven === '' || COVEN_PATTERN.test(trimmedCoven);
  const effectiveCoven = covenValid && trimmedCoven !== '' ? trimmedCoven : undefined;

  // Только заполненные предикаты отправляем на backend.
  const activePredicates = useMemo(
    () => statePredicates.filter((p) => p.value.trim() !== ''),
    [statePredicates],
  );

  const services = useQuery({
    queryKey: ['services.list'],
    queryFn: () => keeperApi.services.list(),
  });

  const q = useQuery({
    queryKey: [
      'incarnations',
      {
        service: serviceFilter,
        status,
        coven: effectiveCoven,
        sort: sortKey,
        sort_dir: sortDir,
        state_filters: activePredicates,
      },
    ],
    queryFn: () =>
      keeperApi.incarnations.list({
        service: serviceFilter || undefined,
        status: status || undefined,
        coven: effectiveCoven,
        limit: 200,
        sort: sortKey,
        sort_dir: sortDir,
        state_filters: activePredicates.length > 0 ? activePredicates : undefined,
      }),
    enabled: covenValid,
    // При 422 (ошибка нечислового значения в numeric-op) — не краш, парсим field-errors.
    retry: (failCount, err) => {
      if (err instanceof ApiError && err.status === 422) return false;
      return failCount < 2;
    },
  });

  // Обрабатываем 422: парсим detail как JSON {errors: [{field, message}]} или
  // используем detail-строку как общее сообщение. Разносим по полям predicate.
  const stateFilter422 = useMemo(() => {
    if (!(q.error instanceof ApiError) || q.error.status !== 422) return null;
    return q.error.message;
  }, [q.error]);

  // При новом 422 — пробрасываем ошибку в first-match поля.
  // Простая эвристика: если detail содержит имя поля — кладём туда.
  // Иначе кладём на первый активный предикат.
  useEffect(() => {
    if (!stateFilter422) {
      setStateFieldErrors({});
      return;
    }
    const errors: Record<string, string> = {};
    // Пробуем найти field из activePredicates в строке детали.
    let matched = false;
    for (const pred of activePredicates) {
      if (stateFilter422.includes(pred.field)) {
        errors[pred.field] = stateFilter422;
        matched = true;
        break;
      }
    }
    // Fallback: первое поле.
    if (!matched && activePredicates.length > 0) {
      errors[activePredicates[0].field] = stateFilter422;
    }
    setStateFieldErrors(errors);
  }, [stateFilter422, activePredicates]);

  // Client-side search (по имени) + coven/traits мультиселект (AND). Sort —
  // server-side; items приходят уже sorted, доп. фильтры не меняют порядок.
  const filtered = useMemo(() => {
    const items = q.data?.items ?? [];
    const term = search.trim().toLowerCase();
    return items.filter((it) => {
      if (term && !it.name.toLowerCase().includes(term)) return false;
      if (!matchesCovenTraitsFilter(it, covenTraitsFilter)) return false;
      return true;
    });
  }, [q.data, search, covenTraitsFilter]);

  // Опции мультиселекта считаем от полного набора (до client-side filter),
  // иначе выбор сужал бы сам себя до нуля видимых опций.
  const covenTraitsSourceItems = q.data?.items ?? [];

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  // Кнопка «Run по набору» (snapshot): активна если выбран сервис + есть активные
  // state-предикаты + есть загруженные результаты.
  const hasStateFilter = activePredicates.length > 0;
  const canRunSet = Boolean(serviceFilter && hasStateFilter && (q.data?.items ?? []).length > 0 && !q.isLoading);

  function handleRunSet() {
    if (!canRunSet || !q.data) return;
    const names = (q.data.items ?? []).map((it: IncarnationGetReply) => it.name);
    const regex = buildSnapshotRegex(names);
    // Передаём в RunWizard через incarnation_regex (сырой готовый regex, без повторного escape).
    // НЕ используем incarnation (одиночное имя) — это другой param, RunWizard обернул бы его
    // заново в ^…$, дав двойное экранирование. incarnation_regex идёт в state as-is.
    const params = new URLSearchParams({
      workload: 'scenario',
      service: serviceFilter,
      incarnation_regex: regex,
    });
    navigate(`/run?${params.toString()}`);
  }

  const serviceItems = services.data?.items ?? [];

  // total из ответа backend; если ответа нет — не показываем счётчик.
  const total = q.data?.total;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Box size={22} /> {t('incarnations:pageTitle')}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canRunSet ? (
            <Button type="button" variant="ghost" onClick={handleRunSet} aria-label={t('incarnations:runSetAria')}>
              <Play size={14} /> {t('incarnations:runSet')}
            </Button>
          ) : null}
          <Link to="/incarnations/new">
            <Button variant="primary">
              <Plus size={14} /> {t('incarnations:create')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Основные фильтры */}
      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>{t('incarnations:filterSearchByName')}</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="redis / postgres / …"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>{t('incarnations:filterService')}</div>
          <select
            value={serviceFilter}
            onChange={(e) => {
              setServiceFilter(e.target.value);
              // При смене сервиса сбрасываем state-фильтры (поля разные у каждого сервиса).
              setStatePredicates([]);
              setStateFieldErrors({});
            }}
            data-testid="incarnations-service-filter"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <option value="">{t('incarnations:filterAnyOption')}</option>
            {serviceItems.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>{t('incarnations:filterStatus')}</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IncarnationStatus | '')}
            data-testid="incarnations-status-filter"
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">{t('incarnations:filterAnyOption')}</option>
            {INCARNATION_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>{t('incarnations:filterCoven')}</div>
          <input
            type="text"
            value={coven}
            onChange={(e) => setCoven(e.target.value)}
            placeholder="prod / staging / ..."
            aria-invalid={!covenValid ? 'true' : undefined}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${covenValid ? 'var(--border)' : 'var(--danger)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {!covenValid ? (
            <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
              {t('incarnations:covenInvalid')}
            </span>
          ) : null}
        </label>
      </div>

      {/* Панель state-фильтра — только при выбранном сервисе */}
      <div>
        <div className={styles.metaKey} style={{ marginBottom: 6 }}>
          {t('incarnations:stateFilterTitle')}
          {serviceFilter ? null : (
            <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>
              ({t('incarnations:stateFilterSelectService')})
            </span>
          )}
        </div>
        {serviceFilter ? (
          <StateFilterPanel
            serviceName={serviceFilter}
            predicates={statePredicates}
            fieldErrors={stateFieldErrors}
            onChange={(next) => {
              setStatePredicates(next);
              setStateFieldErrors({});
            }}
          />
        ) : (
          <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            {t('incarnations:stateFilterSelectService')}
          </div>
        )}
      </div>

      {/* Мультиселект coven+traits (client-side, AND, поверх уже загруженного набора) */}
      {covenTraitsSourceItems.length > 0 ? (
        <CovenTraitsFilter
          items={covenTraitsSourceItems}
          value={covenTraitsFilter}
          onChange={setCovenTraitsFilter}
        />
      ) : null}

      {/* Счётчик total */}
      {total !== undefined && !q.isLoading ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {t('incarnations:totalCount', { count: total })}
          {hasStateFilter ? (
            <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>
              ({t('incarnations:stateFilterActive', { count: activePredicates.length })})
            </span>
          ) : null}
        </div>
      ) : null}

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {q.error && !(q.error instanceof ApiError && q.error.status === 422) ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : null}
      {/* 422: общая плашка дополнительно к per-field ошибкам в панели */}
      {stateFilter422 ? (
        <div className={styles.errorBox}>
          {t('incarnations:stateFilter422', { detail: stateFilter422 })}
        </div>
      ) : null}

      {q.data && filtered.length === 0 ? (
        <div className={styles.empty}>
          {t('incarnations:listEmptyLead')} <strong>{t('incarnations:create')}</strong>{t('incarnations:listEmptyHint')}{' '}
          <code className="mono">create</code> {t('incarnations:listEmptyTail')}
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => toggleSort('name')} style={{ all: 'unset', cursor: 'pointer' }}>
                  {t('incarnations:colName')}{sortArrow('name')}
                </button>
              </th>
              <th>{t('incarnations:colService')}</th>
              <th>
                <button type="button" onClick={() => toggleSort('status')} style={{ all: 'unset', cursor: 'pointer' }}>
                  {t('incarnations:colStatus')}{sortArrow('status')}
                </button>
              </th>
              <th>{t('incarnations:colCovens')}</th>
              <th>{t('incarnations:colTraits')}</th>
              <th>
                <button type="button" onClick={() => toggleSort('created_at')} style={{ all: 'unset', cursor: 'pointer' }}>
                  {t('incarnations:colCreated')}{sortArrow('created_at')}
                </button>
              </th>
              <th>{t('incarnations:colLastDrift')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.name}>
                <td>
                  <Link to={`/incarnations/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                </td>
                <td className="mono">
                  <Link
                    to={`/services/${encodeURIComponent(row.service)}`}
                  >
                    {row.service}
                  </Link>
                  <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>@{row.service_version}</span>
                </td>
                <td>
                  <span className={styles.statusCell}>
                    <Dot kind={incarnationDot(row.status)} title={row.status} />
                    <Badge tone={incarnationTone(row.status)}>{row.status}</Badge>
                  </span>
                </td>
                <td className="mono">
                  {(row.covens ?? []).length > 0 ? (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      {(row.covens ?? []).map((c) => (
                        <Badge key={c} tone="muted">{c}</Badge>
                      ))}
                    </span>
                  ) : '—'}
                </td>
                <td className="mono">
                  <TraitsChips traits={row.traits as Record<string, unknown> | null | undefined} maxVisible={3} />
                </td>
                <td className="mono" title={row.created_at}>{formatTimeAgo(row.created_at)}</td>
                <td className="mono">{formatTimeAgo(row.last_drift_check_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
