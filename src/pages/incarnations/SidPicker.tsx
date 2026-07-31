// SidPicker — autocomplete field for choosing SID(s) with debounce.
// ADR-045 S4: format:sid (single) / type:array+format:sid (multi).
//
// TWO CATALOGS, one widget. Which one is used follows from `source`:
//
//   - incarnation_hosts / choir → module form-prep. Both resolve against an EXISTING
//     incarnation, so without an incarnationContext there is nothing to ask about and
//     the field explains itself instead of pretending to autocomplete.
//   - roster (ADR-081, NIM-371) → the scoped souls list. This is the CREATE case:
//     there is no incarnation yet, so the catalog is the online hosts the caller can
//     see. No incarnationContext is needed or wanted.
//
// If neither applies (a plain sid field with no source) — a text input.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keeperApi } from '../../api/keeper';
import type { ModuleFormPrepRequest, ScenarioInputSource } from '../../api/keeper';

export interface SidPickerProps {
  /** Current value. Single: a string. Multi: a raw JSON array of strings. */
  value: string | undefined;
  onChange: (v: string) => void;
  /** source from the field schema — where SIDs come from (incarnation_hosts/choir/roster). */
  source?: ScenarioInputSource;
  /** Incarnation name from the wizard context (for the incarnation_hosts source). */
  incarnationContext?: string;
  /** Choir name (if source.choir is set and a choir context is needed). */
  choirName?: string;
  /** Module name (needed for the form-prep URL). */
  moduleName: string;
  /**
   * How many hosts the topology needs (roster source only) — shown as a live count so
   * the operator can see they are short or over BEFORE submitting. undefined when the
   * topology does not pin a number yet.
   */
  requiredCount?: number;
  multi?: boolean;
  required?: boolean;
  missing?: boolean;
  disabled?: boolean;
}

const DEBOUNCE_MS = 300;

// Page size of the roster catalog. Matches the form-prep cap so both catalogs
// truncate at the same width and the "narrow your search" hint means the same thing.
const ROSTER_PAGE_SIZE = 50;

export function SidPicker({
  value,
  onChange,
  source,
  incarnationContext,
  choirName,
  moduleName,
  requiredCount,
  multi = false,
  missing = false,
  disabled = false,
}: SidPickerProps) {
  const { t } = useTranslation('run');
  const [prefix, setPrefix] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Current multi-list: parsed from the raw JSON array.
  const multiValues: string[] = multi ? parseMulti(value) : [];

  // The roster catalog (ADR-081): souls an incarnation is being CREATED on. Checked
  // first — it is the one source that must NOT wait for an incarnationContext, since
  // on the create path there is no incarnation yet.
  const isRoster = Boolean(source?.roster);

  // source defines the incarnation/choir binding — single source of truth for both branches below.
  const hasIncarnationSource = Boolean(source?.incarnation_hosts || source?.choir);
  const hasSource = isRoster || hasIncarnationSource;

  // Do we have a context to fetch a catalog with. The roster source needs none.
  const hasContext = isRoster || Boolean(incarnationContext && hasIncarnationSource);

  // Build the body source for form-prep.
  function buildFormPrepSource(): ModuleFormPrepRequest['source'] {
    if (source?.choir && incarnationContext && choirName) {
      return { choir: { incarnation: incarnationContext, name: choirName } };
    }
    // incarnation_hosts — the incarnation name as a string.
    return { incarnation_hosts: incarnationContext ?? '' };
  }

  // Fetch the roster catalog from the scoped souls list. Deliberately NOT form-prep:
  // that endpoint is addressed per module and both its sources need an existing
  // incarnation. `GET /v1/souls` is already narrowed to the caller's soul visibility,
  // so "the picker cannot offer a SID the operator could not otherwise see" holds
  // because it is the same list they browse — not because a second resolver repeats
  // the rule (ADR-081).
  //
  // ★ EXACTLY ONE FILTER, and it is not about ownership. Two narrower ones were tried
  // and are wrong:
  //
  //   - by the incarnation's declared covens. A host inherits an incarnation's labels
  //     only once it BELONGS to it (ADR-080), so a candidate for an incarnation that
  //     does not exist yet cannot carry them. Filtering by them asks a host to already
  //     hold the label it would get by being picked.
  //   - by "unassigned". Membership is M:N (NIM-124) — a host legitimately runs several
  //     incarnations — so belonging to one is not a reason to hide it. That filter
  //     silently shrank the pool the operator was choosing from.
  //
  // What is left is `connected`, which IS an invariant: the keeper refuses to bind
  // anything else, so offering it would be offering a 422. Everything beyond that is
  // the operator's judgement, and the RBAC scope is what keeps other people's hosts
  // out of the list.
  async function fetchRosterCandidates(): Promise<{ sids: string[]; truncated: boolean }> {
    const reply = await keeperApi.souls.list({
      status: 'connected',
      sid_prefix: prefix || undefined,
      limit: ROSTER_PAGE_SIZE,
    });
    const sids = (reply.items ?? []).map((s) => s.sid);
    return { sids, truncated: (reply.total ?? sids.length) > sids.length };
  }

  useEffect(() => {
    if (!hasContext || !open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const fetching = isRoster
        ? fetchRosterCandidates()
        : keeperApi.modules
            .formPrep(moduleName, { source: buildFormPrepSource(), prefix: prefix || undefined })
            .then((r) => ({ sids: r.sids ?? [], truncated: r.truncated ?? false }));
      fetching
        .then((r) => {
          setSuggestions(r.sids);
          setTruncated(r.truncated);
        })
        .catch(() => {
          setSuggestions([]);
          setTruncated(false);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, open, hasContext, isRoster, incarnationContext, moduleName]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const baseStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${missing ? 'var(--danger)' : 'var(--border)'}`,
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  };

  // An incarnation-scoped source is set, but there's no incarnationContext (a
  // free-standing command run). A text input is useless here — the backend can't
  // resolve an arbitrary SID for source:choir/incarnation_hosts without an incarnation
  // binding. Show a clear explanation instead of an input field. The roster source
  // never lands here: it has no incarnation to be missing.
  if (!hasContext && hasSource) {
    const hintKey = source?.choir
      ? 'sidPickerNoContextChoir'
      : 'sidPickerNoContextIncarnationHosts';
    return (
      <div
        data-testid="sid-picker-no-context"
        style={{
          padding: '8px 10px',
          borderRadius: 'var(--radius)',
          border: `1px solid ${missing ? 'var(--danger)' : 'var(--border)'}`,
          background: 'var(--surface-raised)',
          fontSize: 13,
          color: 'var(--text-muted)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {t(hintKey)}
      </div>
    );
  }

  // No source (a plain sid field without source) — a legitimate text input.
  if (!hasContext) {
    return (
      <div>
        <input
          type="text"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('sidPickerFallbackHint')}
          disabled={disabled}
          style={baseStyle}
        />
      </div>
    );
  }

  function selectSid(sid: string) {
    if (multi) {
      const next = multiValues.includes(sid) ? multiValues : [...multiValues, sid];
      onChange(JSON.stringify(next));
    } else {
      onChange(sid);
      setOpen(false);
    }
    setPrefix('');
  }

  function removeSid(sid: string) {
    const next = multiValues.filter((s) => s !== sid);
    onChange(JSON.stringify(next));
  }

  if (multi) {
    // The count the topology asks for, shown live. `requiredCount` is computed from the
    // form's own topology fields, never hardcoded — a picker capped at a literal number
    // would silently disagree with the scenario the moment shards or replicas change.
    const atCapacity = requiredCount !== undefined && multiValues.length >= requiredCount;
    const countLabel =
      requiredCount === undefined
        ? null
        : t('sidPickerSelectedOf', { selected: multiValues.length, required: requiredCount });
    const countTone =
      requiredCount === undefined || multiValues.length === requiredCount
        ? 'var(--text-faint)'
        : 'var(--warning, var(--text-muted))';

    return (
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {countLabel ? (
          <span data-testid="sid-picker-count" style={{ fontSize: 12, color: countTone }}>
            {countLabel}
          </span>
        ) : null}
        {multiValues.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {multiValues.map((sid) => (
              <span
                key={sid}
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '2px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {sid}
                <button
                  type="button"
                  aria-label={t('sidPickerRemove')}
                  onClick={() => removeSid(sid)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={prefix}
            onChange={(e) => { setPrefix(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={atCapacity ? t('sidPickerFull') : t('sidPickerPlaceholder')}
            // At capacity the input closes rather than letting the operator pick an
            // extra host and meet a 422: the count the topology needs is exact, not a
            // minimum. Removing a chip re-opens it.
            disabled={disabled || atCapacity}
            style={{ ...baseStyle, border: `1px solid ${missing && multiValues.length === 0 ? 'var(--danger)' : 'var(--border)'}` }}
            data-testid="sid-picker-multi-input"
          />
          <SuggestionDropdown
            open={open && !atCapacity}
            loading={loading}
            suggestions={suggestions}
            truncated={truncated}
            selected={multiValues}
            onSelect={selectSid}
            t={t}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? prefix : (value ?? '')}
        onChange={(e) => { setPrefix(e.target.value); setOpen(true); }}
        onFocus={() => { setPrefix(value ?? ''); setOpen(true); }}
        onBlur={() => {
          // Small delay so a click on the item has time to fire.
          setTimeout(() => setOpen(false), 150);
        }}
        placeholder={t('sidPickerPlaceholder')}
        disabled={disabled}
        style={baseStyle}
        data-testid="sid-picker-input"
      />
      <SuggestionDropdown
        open={open}
        loading={loading}
        suggestions={suggestions}
        truncated={truncated}
        selected={value ? [value] : []}
        onSelect={selectSid}
        t={t}
      />
    </div>
  );
}

function SuggestionDropdown({
  open,
  loading,
  suggestions,
  truncated,
  selected,
  onSelect,
  t,
}: {
  open: boolean;
  loading: boolean;
  suggestions: string[];
  truncated: boolean;
  selected: string[];
  onSelect: (s: string) => void;
  t: (key: string) => string;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        maxHeight: 200,
        overflowY: 'auto',
      }}
    >
      {loading ? (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          {t('sidPickerLoading')}
        </div>
      ) : suggestions.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)' }}>
          {t('sidPickerNoResults')}
        </div>
      ) : (
        suggestions.map((sid) => (
          <div
            key={sid}
            onMouseDown={(e) => { e.preventDefault(); onSelect(sid); }}
            style={{
              padding: '7px 12px',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              background: selected.includes(sid) ? 'var(--surface-raised)' : undefined,
              color: 'var(--text)',
            }}
            data-testid={`sid-option-${sid}`}
          >
            {sid}
          </div>
        ))
      )}
      {truncated ? (
        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
          {t('sidPickerTruncated')}
        </div>
      ) : null}
    </div>
  );
}

function parseMulti(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // noop
  }
  return [];
}
