// Group editor: the operator defines what a group is, by query or by builder.
//
// Both edit the same string. The builder is shown whenever the query parses,
// because the language is flat by design and therefore always representable as
// rows; a query that fails to parse falls back to text-only with the error, so
// the operator is never locked out of fixing it.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '../../components/primitives';
import type { SoulListEntry } from '../../api/keeper';
import {
  QUERY_OPS,
  availableFields,
  fieldSuggestions,
  formatQuery,
  parseQuery,
  type JoinMode,
  type QueryCondition,
  type QueryOp,
} from './consoleQuery';
import { emptyGroup, splitByField, splittableFields, type ConsoleGroup, type GroupDef } from './consoleGrouping';
import styles from './MultiConsole.module.css';

interface Props {
  defs: GroupDef[];
  onChange: (next: GroupDef[]) => void;
  // Live evaluation of the current defs — counts and per-group errors.
  groups: ConsoleGroup[];
  unmatchedCount: number;
  souls: SoulListEntry[];
  choirsBySid: ReadonlyMap<string, string[]>;
  onClose: () => void;
}

export function GroupsEditor({
  defs,
  onChange,
  groups,
  unmatchedCount,
  souls,
  choirsBySid,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const fields = useMemo(() => availableFields(souls, choirsBySid), [souls, choirsBySid]);
  const splittable = useMemo(() => splittableFields(souls, choirsBySid), [souls, choirsBySid]);

  const update = (id: string, patch: Partial<GroupDef>) =>
    onChange(defs.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className={styles.groupsEditor} data-testid="console-groups-editor">
      <div className={styles.groupsEditorHead}>
        <h2 className={styles.scopeTitle}>{t('console:groupsTitle')}</h2>
        <p className={styles.scopeHint}>{t('console:groupsHint')}</p>
      </div>

      {splittable.length > 0 ? (
        <div className={styles.autoSplit}>
          <Wand2 size={14} />
          <span className={styles.scopeMuted}>{t('console:autoSplit')}</span>
          {splittable.map((field) => (
            <button
              key={field}
              type="button"
              className={styles.autoSplitBtn}
              onClick={() => onChange(splitByField(souls, field, choirsBySid))}
              data-testid={`console-autosplit-${field}`}
            >
              {field}
            </button>
          ))}
          <span className={styles.scopeMuted}>{t('console:autoSplitHint')}</span>
        </div>
      ) : null}

      <div className={styles.groupsList}>
        {defs.length === 0 ? (
          <div className={styles.scopeMuted} data-testid="console-groups-empty">
            {t('console:groupsEmpty')}
          </div>
        ) : null}

        {defs.map((def) => {
          const live = groups.find((g) => g.id === def.id);
          return (
            <GroupRow
              key={def.id}
              def={def}
              count={live?.sids.length ?? 0}
              error={live?.error ?? null}
              fields={fields}
              souls={souls}
              choirsBySid={choirsBySid}
              onChange={(patch) => update(def.id, patch)}
              onRemove={() => onChange(defs.filter((d) => d.id !== def.id))}
            />
          );
        })}
      </div>

      <div className={styles.groupsFoot}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...defs, emptyGroup(t('console:groupDefaultName', { n: defs.length + 1 }))])}
          data-testid="console-group-add"
        >
          <Plus size={15} />
          {t('console:groupAdd')}
        </Button>
        {defs.length > 0 ? (
          <Button type="button" variant="ghost" onClick={() => onChange([])} data-testid="console-groups-clear">
            {t('console:groupsClear')}
          </Button>
        ) : null}
        <span className={styles.spacer} />
        {unmatchedCount > 0 ? (
          <span className={styles.scopeMuted} data-testid="console-groups-unmatched">
            {t('console:groupsUnmatched', { count: unmatchedCount })}
          </span>
        ) : null}
        <Button type="button" variant="primary" onClick={onClose} data-testid="console-groups-done">
          {t('console:groupsDone')}
        </Button>
      </div>
    </div>
  );
}

function GroupRow({
  def,
  count,
  error,
  fields,
  souls,
  choirsBySid,
  onChange,
  onRemove,
}: {
  def: GroupDef;
  count: number;
  error: string | null;
  fields: string[];
  souls: SoulListEntry[];
  choirsBySid: ReadonlyMap<string, string[]>;
  onChange: (patch: Partial<GroupDef>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseQuery(def.query), [def.query]);
  const query = parsed.query;

  // Builder edits go back out as canonical text — one source of truth.
  const setConditions = (conditions: QueryCondition[], join: JoinMode) =>
    onChange({ query: formatQuery({ join, conditions }) });

  return (
    <div className={styles.groupRow} data-testid={`console-group-row-${def.id}`}>
      <div className={styles.groupRowHead}>
        <input
          className={styles.groupName}
          value={def.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('console:groupNamePlaceholder')}
          aria-label={t('console:groupNamePlaceholder')}
          data-testid={`console-group-name-${def.id}`}
        />
        <span className={count > 0 ? styles.groupCount : styles.groupCountZero} data-testid={`console-group-count-${def.id}`}>
          {t('console:groupMatches', { count })}
        </span>
        <button
          type="button"
          className={styles.paneIcon}
          onClick={onRemove}
          aria-label={t('console:groupRemove')}
          data-testid={`console-group-remove-${def.id}`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <input
        className={styles.groupQuery}
        value={def.query}
        onChange={(e) => onChange({ query: e.target.value })}
        placeholder={t('console:groupQueryPlaceholder')}
        aria-label={t('console:groupQueryPlaceholder')}
        spellCheck={false}
        data-testid={`console-group-query-${def.id}`}
      />
      {error ? (
        <span className={styles.scopeWarn} data-testid={`console-group-error-${def.id}`}>
          {error}
        </span>
      ) : null}

      {query ? (
        <div className={styles.builder} data-testid={`console-group-builder-${def.id}`}>
          {query.conditions.map((cond, i) => (
            <div key={i} className={styles.builderRow}>
              {i === 0 ? (
                <span className={styles.builderLead}>{t('console:builderWhere')}</span>
              ) : (
                <select
                  className={styles.builderJoin}
                  value={query.join}
                  onChange={(e) => setConditions(query.conditions, e.target.value as JoinMode)}
                  aria-label={t('console:builderJoin')}
                  data-testid={`console-group-join-${def.id}`}
                >
                  <option value="and">{t('console:builderAnd')}</option>
                  <option value="or">{t('console:builderOr')}</option>
                </select>
              )}

              <select
                className={styles.builderField}
                value={cond.field}
                onChange={(e) => {
                  const next = [...query.conditions];
                  next[i] = { ...cond, field: e.target.value, value: '' };
                  setConditions(next, query.join);
                }}
                aria-label={t('console:builderField')}
                data-testid={`console-group-field-${def.id}-${i}`}
              >
                {[...new Set([cond.field, ...fields])].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>

              <select
                className={styles.builderOp}
                value={cond.op}
                onChange={(e) => {
                  const next = [...query.conditions];
                  next[i] = { ...cond, op: e.target.value as QueryOp };
                  setConditions(next, query.join);
                }}
                aria-label={t('console:builderOp')}
                data-testid={`console-group-op-${def.id}-${i}`}
              >
                {QUERY_OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>

              <input
                className={styles.builderValue}
                value={cond.value}
                list={`vals-${def.id}-${i}`}
                onChange={(e) => {
                  const next = [...query.conditions];
                  next[i] = { ...cond, value: e.target.value };
                  setConditions(next, query.join);
                }}
                placeholder={t('console:builderValue')}
                aria-label={t('console:builderValue')}
                spellCheck={false}
                data-testid={`console-group-value-${def.id}-${i}`}
              />
              <datalist id={`vals-${def.id}-${i}`}>
                {fieldSuggestions(souls, cond.field, choirsBySid).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>

              <button
                type="button"
                className={styles.paneIcon}
                onClick={() => setConditions(query.conditions.filter((_, j) => j !== i), query.join)}
                aria-label={t('console:builderRemoveCondition')}
                data-testid={`console-group-cond-remove-${def.id}-${i}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          <button
            type="button"
            className={styles.builderAdd}
            onClick={() =>
              setConditions(
                [...query.conditions, { field: fields[0] ?? 'sid', op: '=', value: '' }],
                query.join,
              )
            }
            data-testid={`console-group-cond-add-${def.id}`}
          >
            <Plus size={13} />
            {t('console:builderAddCondition')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
