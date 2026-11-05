import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { keeperApi, type ScenarioInputSchemaProperty } from '../../api/keeper';
import { JsonViewer } from '../../components/JsonViewer';
import {
  MASKED,
  buildInputGroups,
  isListOfObjects,
  isPlainObject,
  objectListColumns,
  type InputGroup,
  type InputRow,
} from './runInputView';
import styles from './RunInputView.module.css';

interface Props {
  incarnation: string;
  scenario: string;
  input: Record<string, unknown>;
  // The service git ref the run rendered with; absent when the run recorded none,
  // which a linear run does only at its terminal.
  serviceVersion?: string;
  live?: boolean;
}

type Source =
  | { kind: 'loading' }
  | { kind: 'run'; ref: string }
  | { kind: 'current'; ref: string }
  | { kind: 'live'; ref: string }
  | { kind: 'fallback'; ref: string; runRef: string }
  | { kind: 'none' };

// The run's input by the form of the scenario version it ran on (NIM-1175). The
// schema is asked for at the run's own service_version; when the run recorded none,
// or that ref no longer resolves, at the incarnation's current one — and the hint
// says which. Without a schema the same layout is built from the input's keys.
export function RunInputView({ incarnation, scenario, input, serviceVersion, live }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'fields' | 'json'>('fields');

  const incQ = useQuery({
    queryKey: ['incarnation', incarnation],
    queryFn: () => keeperApi.incarnations.get(incarnation),
    enabled: Boolean(incarnation),
    retry: false,
  });
  const service = incQ.data?.service;
  const currentRef = incQ.data?.service_version || undefined;
  const runRef = serviceVersion || undefined;
  const primaryRef = runRef ?? currentRef;
  const fallbackRef = runRef && currentRef && currentRef !== runRef ? currentRef : undefined;

  const primaryQ = useQuery({
    queryKey: ['services.scenarios', service, primaryRef],
    queryFn: () => keeperApi.services.listScenarios(service!, primaryRef),
    enabled: Boolean(service && primaryRef),
    retry: false,
  });
  const fallbackQ = useQuery({
    queryKey: ['services.scenarios', service, fallbackRef],
    queryFn: () => keeperApi.services.listScenarios(service!, fallbackRef),
    enabled: Boolean(service && fallbackRef && primaryQ.isError),
    retry: false,
  });

  let source: Source = { kind: 'none' };
  let info = primaryQ.data?.scenarios?.find((s) => s.name === scenario);
  if (info && primaryRef) {
    source = runRef
      ? { kind: 'run', ref: primaryRef }
      : { kind: live ? 'live' : 'current', ref: primaryRef };
  } else if (primaryQ.isError && fallbackRef && runRef) {
    info = fallbackQ.data?.scenarios?.find((s) => s.name === scenario);
    if (info) source = { kind: 'fallback', ref: fallbackRef, runRef };
    else if (fallbackQ.isLoading) source = { kind: 'loading' };
  } else if (incQ.isLoading || primaryQ.isLoading) {
    source = { kind: 'loading' };
  }

  const groups = useMemo(() => buildInputGroups(input, info), [input, info]);

  const sourceText =
    source.kind === 'run'
      ? t('runhistory:runInputSourceRun', { scenario, ref: source.ref })
      : source.kind === 'current'
        ? t('runhistory:runInputSourceCurrent', { scenario, ref: source.ref })
        : source.kind === 'live'
          ? t('runhistory:runInputSourceLive', { scenario, ref: source.ref })
          : source.kind === 'fallback'
          ? t('runhistory:runInputSourceFallback', { scenario, ref: source.ref, runRef: source.runRef })
          : source.kind === 'loading'
            ? t('runhistory:runInputSourceLoading')
            : t('runhistory:runInputSourceNone');

  return (
    <>
      <div className={styles.head}>
        <p className={styles.hint} data-testid="run-input-source" data-source={source.kind}>
          {t('runhistory:runInputMaskedHint')} {sourceText}
        </p>
        <div className={styles.toggle} role="group" aria-label={t('runhistory:runInputViewAria')}>
          <button
            type="button"
            className={mode === 'fields' ? styles.toggleOn : undefined}
            aria-pressed={mode === 'fields'}
            onClick={() => setMode('fields')}
            data-testid="run-input-mode-fields"
          >
            {t('runhistory:runInputViewFields')}
          </button>
          <button
            type="button"
            className={mode === 'json' ? styles.toggleOn : undefined}
            aria-pressed={mode === 'json'}
            onClick={() => setMode('json')}
            data-testid="run-input-mode-json"
          >
            {t('runhistory:runInputViewJson')}
          </button>
        </div>
      </div>
      {mode === 'json' ? (
        <JsonViewer value={input} />
      ) : (
        <div className={styles.groups} data-testid="run-input-groups">
          {groups.map((g) => (
            <InputGroupBlock key={g.key} group={g} />
          ))}
        </div>
      )}
    </>
  );
}

function InputGroupBlock({ group }: { group: InputGroup }) {
  const { t } = useTranslation();
  const title =
    group.kind === 'other'
      ? t('run:formDefaultSection')
      : group.kind === 'unknown'
        ? t('runhistory:runInputNotInSchema')
        : group.title;
  return (
    <section
      className={`${styles.group} ${group.wide ? styles.wide : ''}`}
      data-testid={`run-input-group-${group.key}`}
    >
      {title ? <div className={styles.groupTitle}>{title}</div> : null}
      {group.kind === 'unknown' ? <div className={styles.note}>{t('runhistory:runInputNotInSchemaHint')}</div> : null}
      <div className={styles.rows}>
        {group.rows.map((r) => (
          <InputRowView key={r.key} row={r} />
        ))}
      </div>
    </section>
  );
}

function InputRowView({ row }: { row: InputRow }) {
  const { t } = useTranslation();
  return (
    <div
      className={`${styles.row} ${row.present && isListOfObjects(row.value) ? styles.stacked : ''}`}
      data-testid={`run-input-row-${row.key}`}
    >
      <div className={styles.label} title={row.description}>
        {row.label}
        {row.label !== row.key ? <span className={styles.key}>{row.key}</span> : null}
      </div>
      <div className={styles.value}>
        {row.present ? (
          <>
            <InputValue value={row.value} prop={row.prop} />
            {row.isDefault ? (
              <span className={styles.badge} data-testid="run-input-default">
                {t('runhistory:runInputDefault')}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className={styles.unset} data-testid="run-input-unset">
              {t('runhistory:runInputUnset')}
            </span>
            {row.prop?.default !== undefined ? (
              <span className={styles.muted}>
                {' · '}
                {t('runhistory:runInputDefaultWas', { value: scalarText(row.prop.default) })}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function InputValue({ value, prop }: { value: unknown; prop?: ScenarioInputSchemaProperty }) {
  const { t } = useTranslation();
  if (value === MASKED) {
    return (
      <span className={styles.masked} data-testid="run-input-masked">
        <Lock size={12} aria-hidden="true" />
        {t('runhistory:runInputMasked')}
      </span>
    );
  }
  if (value === null || value === undefined) {
    return <span className={styles.unset}>{t('runhistory:runInputUnset')}</span>;
  }
  if (typeof value === 'boolean') {
    return <span>{value ? t('runhistory:runInputTrue') : t('runhistory:runInputFalse')}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.unset}>{t('runhistory:runInputEmpty')}</span>;
    if (isListOfObjects(value)) {
      const itemProp = prop?.items;
      const cols = objectListColumns(value, itemProp);
      return (
        <table className={styles.table}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((item, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>
                    {c in item ? <InputValue value={item[c]} prop={itemProp?.properties?.[c]} /> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return (
      <span className={styles.chips}>
        {value.map((v, i) => (
          <span key={i} className={styles.chip}>
            <InputValue value={v} prop={prop?.items} />
          </span>
        ))}
      </span>
    );
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return <span className={styles.unset}>{t('runhistory:runInputEmpty')}</span>;
    const valueProp = (k: string) =>
      prop?.properties?.[k] ??
      (typeof prop?.additional_properties === 'object' ? prop.additional_properties : undefined) ??
      prop?.items;
    return (
      <table className={styles.table}>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className={styles.mapKey}>{k}</td>
              <td>
                <InputValue value={value[k]} prop={valueProp(k)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <span>{String(value)}</span>;
}

function scalarText(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}
