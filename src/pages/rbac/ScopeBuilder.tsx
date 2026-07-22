import { Fragment, memo, useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SCOPE_DIMS,
  serializeScope,
  type ScopeCond,
  type ScopeDim,
  type ScopeGroup,
  type ScopeNode,
} from './scopeExpr';
import { newCond, newGroup, pruneScope } from './scopeBuilderModel';
import { useAutocompleteOptions } from './useScopeAutocomplete';
import { useMyPermissions } from '../../hooks/useMyPermissions';

// Boolean condition-builder for an RBAC permission scope (NIM-128). Edits a
// ScopeNode tree (usually a ScopeGroup root) over five dimensions — coven /
// service / incarnation / host / trait — joined by AND/OR with nested groups.
// The wire form is the CANONICAL string produced by serializeScope (scopeExpr.ts);
// this component never touches strings except for the live preview / copy.
// Visual: approved mockup design/rbac-mockups/scope-builder.v2.mockup.html.

interface Props {
  /** Root scope node, or null = "no restriction" (unrestricted). */
  value: ScopeNode | null;
  onChange: (next: ScopeNode | null) => void;
  ariaLabel?: string;
  /** Base permission (`resource.action` | `resource.*`) — drives the inherited-ceiling hint. */
  base?: string;
}

const dimColor = (dim: ScopeDim) => `var(--scope-${dim})`;
const railColor = (op: 'and' | 'or') => (op === 'and' ? 'var(--rail-and)' : 'var(--rail-or)');

// display-side quoting — mirrors scopeExpr.ts so the preview matches the wire form.
const DQ_EXACT = /^[A-Za-z0-9_.-]+$/;
const DQ_GLOB = /^[A-Za-z0-9_.*?-]+$/;
const dq = (v: string) => (DQ_EXACT.test(v) ? v : `"${v}"`);
const dqGlob = (v: string) => (DQ_GLOB.test(v) ? v : `"${v}"`);

// --- shared styles ---

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12.5,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
};

const opLabelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  borderRadius: 8,
  padding: '6px 10px',
  whiteSpace: 'nowrap',
};

const addBtn = (primary: boolean): CSSProperties => ({
  border: `1px dashed ${primary ? 'color-mix(in srgb, var(--accent) 45%, var(--border))' : 'var(--border-strong)'}`,
  background: primary ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
  color: primary ? 'var(--accent)' : 'var(--text-muted)',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 8,
  padding: '7px 13px',
  cursor: 'pointer',
});

// --- value chips (coven / service / incarnation / host-in-list) ---

function ValueChips({
  dim,
  values,
  onChange,
}: {
  dim: ScopeDim;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  // Lazy autocomplete: don't fetch the option catalog until the field is focused
  // (avoids firing every list endpoint on mount — droplist warm-up was 1-2s).
  const [activated, setActivated] = useState(false);
  const options = useAutocompleteOptions(dim, activated);
  const [draft, setDraft] = useState('');
  const listId = useId();
  const color = dimColor(dim);

  const add = (raw: string) => {
    const v = raw.trim();
    setDraft('');
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
  };
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i));
  const remaining = options.filter((o) => !values.includes(o)).slice(0, 200);

  return (
    <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 170 }}>
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            borderRadius: 'var(--radius-pill)',
            padding: '4px 6px 4px 10px',
            border: `1px solid color-mix(in srgb, ${color} 55%, var(--border))`,
            background: `color-mix(in srgb, ${color} 13%, transparent)`,
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
          {v}
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label={t('admin:rbacScopeRemoveValue', { value: v })}
            style={{ border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        data-testid="scope-add-value"
        list={remaining.length > 0 ? listId : undefined}
        value={draft}
        onFocus={() => setActivated(true)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        placeholder={values.length === 0 ? t('admin:rbacScopeAddValue') : ''}
        aria-label={t('admin:rbacScopeValueInputAria', { dim })}
        style={{ ...inputStyle, minWidth: 110, flex: 1 }}
      />
      {remaining.length > 0 ? (
        <datalist id={listId}>
          {remaining.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </span>
  );
}

// --- single condition row ---

function CondBody({ cond, onChange }: { cond: ScopeCond; onChange: (next: ScopeNode) => void }) {
  const { t } = useTranslation();

  if (cond.dim === 'trait') {
    // Flat inline row `[key] = [value]` (aligned with the dim select and the
    // other conditions). The `trait.` prefix/dot is shown in the RESULTING RULE
    // preview, not inline; placeholders convey key/value.
    return (
      <>
        <input
          type="text"
          data-testid="scope-trait-key"
          value={cond.key ?? ''}
          onChange={(e) => onChange({ ...cond, key: e.target.value })}
          placeholder={t('admin:rbacScopeTraitKeyPlaceholder')}
          aria-label={t('admin:rbacScopeTraitKeyAria')}
          style={{ ...inputStyle, maxWidth: 130 }}
        />
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>=</span>
        <input
          type="text"
          data-testid="scope-trait-value"
          value={cond.values[0] ?? ''}
          onChange={(e) => onChange({ ...cond, values: [e.target.value] })}
          placeholder={t('admin:rbacScopeTraitValuePlaceholder')}
          aria-label={t('admin:rbacScopeTraitValueAria')}
          style={{ ...inputStyle, maxWidth: 150 }}
        />
      </>
    );
  }

  // host / incarnation — both support an in-list (chips) or matches-glob mode.
  if (cond.dim === 'host' || cond.dim === 'incarnation') {
    const globPlaceholder = cond.dim === 'host' ? 'redis-*' : 'payments-*';
    const globHint = cond.dim === 'host' ? t('admin:rbacScopeGlobHint') : t('admin:rbacScopeGlobHintIncarnation');
    return (
      <>
        <select
          data-testid="scope-host-mode"
          value={cond.match}
          onChange={(e) => {
            const match = e.target.value as ScopeCond['match'];
            onChange({
              ...cond,
              match,
              values: match === 'matches' ? cond.values.slice(0, 1) : cond.values,
            });
          }}
          aria-label={t('admin:rbacScopeMatchAria')}
          style={{ ...opLabelStyle, cursor: 'pointer' }}
        >
          <option value="in">{t('admin:rbacScopeHostIn')}</option>
          <option value="matches">{t('admin:rbacScopeHostMatches')}</option>
        </select>
        {cond.match === 'matches' ? (
          <>
            <input
              type="text"
              data-testid="scope-glob"
              value={cond.values[0] ?? ''}
              onChange={(e) => onChange({ ...cond, values: [e.target.value] })}
              placeholder={globPlaceholder}
              aria-label={t('admin:rbacScopeGlobAria')}
              style={{ ...inputStyle, minWidth: 120 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {globHint}
            </span>
          </>
        ) : (
          <ValueChips dim={cond.dim} values={cond.values} onChange={(vals) => onChange({ ...cond, values: vals })} />
        )}
      </>
    );
  }

  // coven / service — exact set (any-of)
  return (
    <>
      <span style={{ ...opLabelStyle, cursor: 'default' }}>{t('admin:rbacScopeAnyOf')}</span>
      <ValueChips dim={cond.dim} values={cond.values} onChange={(vals) => onChange({ ...cond, values: vals })} />
    </>
  );
}

function CondView({ cond, onChange }: { cond: ScopeCond; onChange: (next: ScopeNode | null) => void }) {
  const { t } = useTranslation();
  const color = dimColor(cond.dim);
  return (
    <div
      data-t={cond.dim}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 11px 9px 12px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius)',
        flexWrap: 'wrap',
      }}
    >
      <select
        data-testid="scope-dim"
        value={cond.dim}
        onChange={(e) => onChange(newCond(e.target.value as ScopeDim))}
        aria-label={t('admin:rbacScopeDimAria')}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          fontWeight: 500,
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '6px 10px',
          background: 'var(--surface-2)',
          color: 'var(--text)',
          cursor: 'pointer',
        }}
      >
        {SCOPE_DIMS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <CondBody cond={cond} onChange={onChange} />
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label={t('admin:rbacScopeRemoveCond')}
        style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', width: 24, height: 24, borderRadius: 6, fontSize: 13 }}
      >
        ✕
      </button>
    </div>
  );
}

// --- group (segmented ALL·AND / ANY·OR + rail + rows + adds) ---

function Segmented({ op, onChange }: { op: 'and' | 'or'; onChange: (op: 'and' | 'or') => void }) {
  const seg = (active: boolean, kind: 'and' | 'or'): CSSProperties => ({
    border: 0,
    background: active ? railColor(kind) : 'transparent',
    color: active ? (kind === 'or' ? '#2b1a00' : '#fff') : 'var(--text-muted)',
    fontWeight: 600,
    fontSize: 11.5,
    letterSpacing: '.02em',
    padding: '4px 12px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
  });
  return (
    <span
      style={{
        display: 'inline-flex',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-pill)',
        padding: 2,
      }}
    >
      <button type="button" data-testid="scope-seg-all" aria-pressed={op === 'and'} onClick={() => onChange('and')} style={seg(op === 'and', 'and')}>
        ALL · AND
      </button>
      <button type="button" data-testid="scope-seg-any" aria-pressed={op === 'or'} onClick={() => onChange('or')} style={seg(op === 'or', 'or')}>
        ANY · OR
      </button>
    </span>
  );
}

function JoinLabel({ op }: { op: 'and' | 'or' }) {
  const color = railColor(op);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0 3px 2px' }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '.06em',
          color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          borderRadius: 'var(--radius-pill)',
          padding: '2px 9px',
        }}
      >
        {op === 'and' ? 'AND' : 'OR'}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function GroupView({
  group,
  onChange,
  depth,
}: {
  group: ScopeGroup;
  onChange: (next: ScopeNode | null) => void;
  depth: number;
}) {
  const { t } = useTranslation();
  const nested = depth > 0;

  const setChild = (i: number, next: ScopeNode | null) => {
    const children =
      next == null ? group.children.filter((_, j) => j !== i) : group.children.map((c, j) => (j === i ? next : c));
    if (children.length === 0) {
      onChange(null); // empty group removes itself (root → unrestricted)
      return;
    }
    onChange({ ...group, children });
  };

  return (
    <div
      data-join={group.op}
      style={{
        position: 'relative',
        borderRadius: 'var(--radius)',
        padding: '14px 14px 14px 16px',
        background: nested ? 'var(--surface)' : 'var(--surface-2)',
        border: '1px solid var(--border)',
        margin: nested ? '2px 0' : 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 3, background: railColor(group.op) }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('admin:rbacScopeGroupLead')}</span>
        <Segmented op={group.op} onChange={(op) => onChange({ ...group, op })} />
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('admin:rbacScopeGroupTrail')}</span>
        {nested ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('admin:rbacScopeRemoveGroup')}
            style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', width: 26, height: 26, borderRadius: 7, fontSize: 15 }}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {group.children.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <JoinLabel op={group.op} /> : null}
            {child.kind === 'group' ? (
              <GroupView group={child} onChange={(n) => setChild(i, n)} depth={depth + 1} />
            ) : (
              <CondView cond={child} onChange={(n) => setChild(i, n)} />
            )}
          </Fragment>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          data-testid="scope-add-cond"
          onClick={() => onChange({ ...group, children: [...group.children, newCond('coven')] })}
          style={addBtn(true)}
        >
          {t('admin:rbacScopeAddCond')}
        </button>
        <button
          type="button"
          data-testid="scope-add-group"
          onClick={() => onChange({ ...group, children: [...group.children, newGroup('or')] })}
          style={addBtn(false)}
        >
          {t('admin:rbacScopeAddGroup')}
        </button>
      </div>
    </div>
  );
}

// --- live preview (syntax-highlighted, matches canonical serialization) ---

function PreviewCond({ c }: { c: ScopeCond }) {
  const color = dimColor(c.dim);
  const kw = (txt: string) => <span style={{ color, fontWeight: 600 }}>{txt}</span>;
  const op = (txt: string) => <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{txt}</span>;
  const paren = (txt: string) => <span style={{ color: 'var(--text-faint)' }}>{txt}</span>;

  if (c.dim === 'trait') return <>{kw(`trait.${c.key}`)} = {dq(c.values[0] ?? '')}</>;
  if (c.match === 'matches') return <>{kw(c.dim)} {op('matches')} {dqGlob(c.values[0] ?? '')}</>;
  if (c.values.length === 1) return <>{kw(c.dim)} = {dq(c.values[0])}</>;
  return (
    <>
      {kw(c.dim)} {op('in')} {paren('(')}
      {c.values.map(dq).join(', ')}
      {paren(')')}
    </>
  );
}

function PreviewGroup({ group, top }: { group: ScopeGroup; top: boolean }) {
  const opWord = group.op === 'and' ? 'AND' : 'OR';
  const color = railColor(group.op);
  return (
    <>
      {group.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <>
              {top ? '\n' : ' '}
              <span style={{ color, fontWeight: 700 }}>{opWord}</span>{' '}
            </>
          ) : null}
          {child.kind === 'group' && child.children.length > 1 ? (
            <>
              <span style={{ color: 'var(--text-faint)' }}>(</span>
              <PreviewGroup group={child} top={false} />
              <span style={{ color: 'var(--text-faint)' }}>)</span>
            </>
          ) : child.kind === 'group' ? (
            <PreviewGroup group={child} top={false} />
          ) : (
            <PreviewCond c={child} />
          )}
        </Fragment>
      ))}
    </>
  );
}

function ScopePreview({ node }: { node: ScopeNode | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const pruned = pruneScope(node);

  if (!pruned) {
    return (
      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }} data-testid="scope-preview-empty">
        {t('admin:rbacScopeEmpty')}
      </div>
    );
  }

  const copy = () => {
    try {
      navigator.clipboard?.writeText(serializeScope(pruned));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div style={{ margin: '18px 0 4px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
          {t('admin:rbacScopeResult')}
        </span>
        <button
          type="button"
          onClick={copy}
          style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 11, borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}
        >
          {copied ? t('admin:rbacScopeCopied') : t('admin:rbacScopeCopy')}
        </button>
      </div>
      <div
        data-testid="scope-preview-code"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.75, padding: '13px 15px', color: 'var(--text)', whiteSpace: 'pre-wrap' }}
      >
        {pruned.kind === 'group' ? <PreviewGroup group={pruned} top /> : <PreviewCond c={pruned} />}
      </div>
    </div>
  );
}

// --- inherited ceiling (least-privilege, read-only) ---

// Shows the caller's own scope ceiling for the edited permission: the server caps
// any grant to a subset of what you hold. Purely informational (the server still
// enforces it — 403 on exceeding). Renders nothing when the ceiling is unknown.
function InheritedCeiling({ base }: { base: string }) {
  const { t } = useTranslation();
  const { ceilingFor } = useMyPermissions();
  const ceiling = ceilingFor(base);
  if (!ceiling) return null;

  return (
    <div
      data-testid="scope-inherited-ceiling"
      style={{
        margin: '12px 0 2px',
        padding: '10px 13px',
        borderRadius: 'var(--radius)',
        border: '1px dashed var(--border)',
        background: 'color-mix(in srgb, var(--text-faint) 5%, transparent)',
        fontSize: 12,
        color: 'var(--text-muted)',
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
        {t('admin:rbacScopeCeilingHeading')}
      </div>
      {ceiling.unrestricted ? (
        <span>{t('admin:rbacScopeCeilingUnrestricted')}</span>
      ) : (
        <span>
          {t('admin:rbacScopeCeilingCapped')}{' '}
          {ceiling.exprs.length > 0 ? (
            ceiling.exprs.map((e, i) => (
              <Fragment key={i}>
                {i > 0 ? ', ' : ''}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)' }}>{e}</code>
              </Fragment>
            ))
          ) : (
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>—</code>
          )}
        </span>
      )}
    </div>
  );
}

// --- root ---

// Memoized: with a stable `onChange` (cached per-base by the parent editor), an
// unrelated scope keystroke elsewhere won't re-render every mounted builder.
export const ScopeBuilder = memo(function ScopeBuilder({ value, onChange, ariaLabel, base }: Props) {
  const { t } = useTranslation();
  const root: ScopeGroup | null =
    value == null ? null : value.kind === 'group' ? value : { kind: 'group', op: 'and', children: [value] };
  const conditionsOn = root != null;

  const modeBtn = (active: boolean): CSSProperties => ({
    border: 0,
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    boxShadow: active ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,.06))' : 'none',
    fontSize: 12.5,
    fontWeight: 500,
    padding: '6px 15px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
  });

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('admin:rbacScopeBuilderAria')}
      style={{
        marginTop: 8,
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          gap: 3,
          margin: '12px 14px 0',
          padding: 3,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-pill)',
        }}
      >
        <button
          type="button"
          data-testid="scope-mode-off"
          aria-pressed={!conditionsOn}
          onClick={() => onChange(null)}
          style={modeBtn(!conditionsOn)}
        >
          {t('admin:rbacScopeModeUnrestricted')}
        </button>
        <button
          type="button"
          data-testid="scope-mode-on"
          aria-pressed={conditionsOn}
          onClick={() => {
            if (!conditionsOn) onChange(newGroup('and'));
          }}
          style={modeBtn(conditionsOn)}
        >
          {t('admin:rbacScopeModeConditions')}
        </button>
      </div>

      {conditionsOn && root ? (
        <div style={{ padding: '16px 14px 12px' }}>
          <GroupView group={root} onChange={onChange} depth={0} />
          <ScopePreview node={root} />
          {base ? <InheritedCeiling base={base} /> : null}
        </div>
      ) : (
        <div style={{ padding: '14px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          {t('admin:rbacScopeUnrestrictedHint')}
          {base ? <InheritedCeiling base={base} /> : null}
        </div>
      )}
    </div>
  );
});
