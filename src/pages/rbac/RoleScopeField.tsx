import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ScopeBuilder } from './ScopeBuilder';
import { RawScopeFallback } from './RawScopeFallback';
import { slotFromScope, slotScopeString, type ScopeSlot } from './scopeBuilderModel';
import { conjoinScopes } from './scopeExpr';
import { ceilingExpr, type ParentBounds } from './roleCeiling';

// The role's own `default_scope`: the scope every permission of the role inherits when
// it carries none of its own. On a DERIVED role (ADR-078) this same field is what the
// role adds on top of its parent — the effective scope is `parent's resolved scope AND
// this field`.
//
// Which means the field decides how the role follows the parent over time, and BOTH
// directions are live: narrowing the parent narrows every child, widening it widens them.
// Hence the two modes:
//
//   track — store the delta alone. The role follows the parent both ways. Right when the
//           parent IS the boundary you want to keep tracking.
//   pin   — store `the parent's scope as it is now AND the delta`. The conjunction keeps
//           that predicate no matter what the parent does later, so a widening of the
//           parent cannot reach this role; a narrowing still does (it is a conjunction).
//
// Nothing server-side distinguishes the two — pin is simply a fatter default_scope.

export type ScopeMode = 'track' | 'pin';

interface Props {
  /** Emits the canonical scope string to store ('' = none). */
  onChange: (next: string) => void;
  /** Seed for the builder state — the stored scope when editing an existing role. */
  initial?: string;
  parent?: ParentBounds;
  mode?: ScopeMode;
  onModeChange?: (mode: ScopeMode) => void;
  /**
   * On a PLAIN role: the scope the caller holds the picked permissions under. The server
   * refuses a grant wider than the caller's own (403), and a plain role has no parent to
   * supply the scope — so leaving this field empty is a guaranteed refusal, and the field
   * says so with a one-click fix.
   */
  callerFloor?: string;
}

export function RoleScopeField({
  onChange,
  initial,
  parent,
  mode = 'track',
  onModeChange,
  callerFloor,
}: Props) {
  const { t } = useTranslation();
  const [slot, setSlot] = useState<ScopeSlot>(() => slotFromScope(initial) ?? { kind: 'tree', node: null });

  const parentScope = ceilingExpr(parent?.scopeCeiling);
  // Pinning needs the parent's expression to be re-serializable; a scope this client
  // can't parse would have to be string-glued, which can silently widen the predicate.
  const pinnable = parentScope !== '' && (() => {
    try {
      conjoinScopes(parentScope, '');
      return true;
    } catch {
      return false;
    }
  })();

  // What actually goes into default_scope for a given delta + mode.
  const stored = (delta: string, m: ScopeMode): string => {
    if (m !== 'pin' || !pinnable) return delta;
    try {
      return conjoinScopes(parentScope, delta);
    } catch {
      return delta;
    }
  };

  const storedNow = stored(slotScopeString(slot), mode);

  // The stored value is a function of (slot, mode, parent), and `mode` is owned by the
  // form — a default chosen once the caller's rights load must reach the form too, not
  // only a click on the toggle. One emit on change covers both.
  const emit = useRef(onChange);
  emit.current = onChange;
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (lastEmitted.current === storedNow) return;
    lastEmitted.current = storedNow;
    emit.current(storedNow);
  }, [storedNow]);

  const modeBtn = (active: boolean): CSSProperties => ({
    border: 0,
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    boxShadow: active ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,.06))' : 'none',
    fontSize: 12.5,
    fontWeight: 500,
    padding: '6px 13px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
  });

  // A plain role with an empty scope grants the caller's rights unscoped — wider than
  // the caller holds them, which the enforcer refuses. Warn instead of silently filling
  // it in: the operator may want to narrow further than their own floor.
  const floorMissing = !parent && Boolean(callerFloor) && slotScopeString(slot) === '';

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {parent
          ? t('admin:rbacRoleScopeDeltaProse', { name: parent.role.name })
          : t('admin:rbacRoleScopeProse')}
      </p>

      {parent && pinnable ? (
        <div data-testid="role-scope-mode" style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'inline-flex',
              gap: 3,
              padding: 3,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)',
            }}
          >
            <button
              type="button"
              data-testid="role-scope-mode-track"
              aria-pressed={mode === 'track'}
              onClick={() => onModeChange?.('track')}
              style={modeBtn(mode === 'track')}
            >
              {t('admin:rbacScopeModeTrack')}
            </button>
            <button
              type="button"
              data-testid="role-scope-mode-pin"
              aria-pressed={mode === 'pin'}
              onClick={() => onModeChange?.('pin')}
              style={modeBtn(mode === 'pin')}
            >
              {t('admin:rbacScopeModePin')}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 }}>
            {mode === 'pin'
              ? t('admin:rbacScopeModePinProse', { name: parent.role.name, scope: parentScope })
              : t('admin:rbacScopeModeTrackProse', { name: parent.role.name })}
          </div>
        </div>
      ) : null}

      {slot.kind === 'raw' ? (
        <RawScopeFallback
          text={slot.text}
          ariaLabel={t('admin:rbacRoleScopeRawAria')}
          onChange={(text) => setSlot({ kind: 'raw', text })}
          onReset={() => setSlot({ kind: 'tree', node: null })}
        />
      ) : (
        <ScopeBuilder
          value={slot.node}
          onChange={(node) => setSlot({ kind: 'tree', node })}
          ariaLabel={parent ? t('admin:rbacRoleScopeDeltaAria', { name: parent.role.name }) : t('admin:rbacRoleScopeAria')}
          ceiling={parent?.scopeCeiling}
          inheritedFrom={parent?.role.name}
        />
      )}

      {floorMissing ? (
        <div
          data-testid="role-scope-caller-floor"
          style={{
            marginTop: 10,
            padding: '10px 13px',
            borderRadius: 'var(--radius)',
            border: '1px solid color-mix(in srgb, var(--warning) 40%, var(--border))',
            background: 'color-mix(in srgb, var(--warning) 7%, transparent)',
            fontSize: 12.5,
            color: 'var(--text-muted)',
            lineHeight: 1.55,
          }}
        >
          {t('admin:rbacRoleScopeCallerFloor', { scope: callerFloor })}
          <button
            type="button"
            data-testid="role-scope-apply-floor"
            onClick={() => {
              const seeded = slotFromScope(callerFloor);
              if (seeded) setSlot(seeded);
            }}
            style={{
              display: 'block',
              marginTop: 8,
              fontSize: 12,
              padding: '4px 11px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {t('admin:rbacRoleScopeApplyFloor')}
          </button>
        </div>
      ) : null}

      {parent && mode === 'pin' ? (
        <div
          data-testid="role-scope-stored"
          style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}
        >
          {t('admin:rbacScopeStoredAs')}{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)' }}>
            {storedNow || '—'}
          </code>
        </div>
      ) : null}
    </div>
  );
}
