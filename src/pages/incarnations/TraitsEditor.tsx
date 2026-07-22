import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';

/** Trait value: a string or a list of strings (ADR-060: scalar | list of scalars). */
export type TraitValue = string | string[];

/** Internal state of one editor row. */
interface TraitRow {
  key: string;
  /** Mode: 'string' - a single string, 'list' - chips. */
  mode: 'string' | 'list';
  strVal: string;
  listVal: string[];
}

export type TraitsMap = Record<string, TraitValue>;

interface Props {
  value: TraitsMap;
  onChange: (next: TraitsMap) => void;
}

function rowsFromMap(map: TraitsMap): TraitRow[] {
  return Object.entries(map).map(([key, val]) => ({
    key,
    mode: Array.isArray(val) ? 'list' : 'string',
    strVal: Array.isArray(val) ? '' : val,
    listVal: Array.isArray(val) ? val : [],
  }));
}

function rowsToMap(rows: TraitRow[]): TraitsMap {
  const result: TraitsMap = {};
  for (const row of rows) {
    if (!row.key) continue;
    result[row.key] = row.mode === 'list' ? row.listVal : row.strVal;
  }
  return result;
}

function newRow(): TraitRow {
  return { key: '', mode: 'string', strVal: '', listVal: [] };
}

/** Incarnation trait-label editor. key -> scalar or list (mode-switch). */
export function TraitsEditor({ value, onChange }: Props) {
  const { t } = useTranslation();

  // Internal row state (not synced outward on every keystroke in the key field,
  // only on blur or when the value changes - see below).
  const [rows, setRows] = useState<TraitRow[]>(() => {
    const initial = rowsFromMap(value);
    return initial.length > 0 ? initial : [];
  });

  function update(next: TraitRow[]) {
    setRows(next);
    onChange(rowsToMap(next));
  }

  function addRow() {
    update([...rows, newRow()]);
  }

  function removeRow(idx: number) {
    update(rows.filter((_, i) => i !== idx));
  }

  function setKey(idx: number, key: string) {
    const next = rows.map((r, i) => (i === idx ? { ...r, key } : r));
    setRows(next);
    // Publish outward immediately (needed so the map stays up to date).
    onChange(rowsToMap(next));
  }

  function setStrVal(idx: number, strVal: string) {
    const next = rows.map((r, i) => (i === idx ? { ...r, strVal } : r));
    setRows(next);
    onChange(rowsToMap(next));
  }

  function toggleMode(idx: number) {
    const next = rows.map((r, i) => {
      if (i !== idx) return r;
      if (r.mode === 'string') {
        // string -> list: put strVal as the first element if not empty
        return { ...r, mode: 'list' as const, listVal: r.strVal ? [r.strVal] : [], strVal: '' };
      } else {
        // list -> string: take the first element or an empty string
        return { ...r, mode: 'string' as const, strVal: r.listVal[0] ?? '', listVal: [] };
      }
    });
    update(next);
  }

  function addChip(idx: number, raw: string) {
    const tok = raw.trim();
    if (!tok) return false;
    const row = rows[idx];
    if (row.listVal.includes(tok)) return false;
    const next = rows.map((r, i) =>
      i === idx ? { ...r, listVal: [...r.listVal, tok] } : r,
    );
    update(next);
    return true;
  }

  function removeChip(rowIdx: number, chipIdx: number) {
    const next = rows.map((r, i) =>
      i === rowIdx ? { ...r, listVal: r.listVal.filter((_, ci) => ci !== chipIdx) } : r,
    );
    update(next);
  }

  return (
    <div data-testid="traits-editor" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, idx) => (
        <TraitRow
          key={idx}
          row={row}
          onKeyChange={(k) => setKey(idx, k)}
          onStrValChange={(v) => setStrVal(idx, v)}
          onToggleMode={() => toggleMode(idx)}
          onAddChip={(raw) => addChip(idx, raw)}
          onRemoveChip={(ci) => removeChip(idx, ci)}
          onRemoveRow={() => removeRow(idx)}
        />
      ))}
      <button
        type="button"
        onClick={addRow}
        data-testid="traits-add-row"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          padding: '4px 10px',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)',
          background: 'transparent',
          color: 'var(--text-muted)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <Plus size={12} />
        {t('incarnations:traitsAddRow')}
      </button>
    </div>
  );
}

// ─── internal single-row component ───────────────────────────────────────

interface RowProps {
  row: TraitRow;
  onKeyChange: (k: string) => void;
  onStrValChange: (v: string) => void;
  onToggleMode: () => void;
  onAddChip: (raw: string) => boolean;
  onRemoveChip: (ci: number) => void;
  onRemoveRow: () => void;
}

function TraitRow({
  row,
  onKeyChange,
  onStrValChange,
  onToggleMode,
  onAddChip,
  onRemoveChip,
  onRemoveRow,
}: RowProps) {
  const { t } = useTranslation();
  const [chipDraft, setChipDraft] = useState('');

  function onChipKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (chipDraft.trim()) {
        e.preventDefault();
        if (onAddChip(chipDraft)) setChipDraft('');
      }
    } else if (e.key === 'Backspace' && chipDraft === '' && row.listVal.length > 0) {
      onRemoveChip(row.listVal.length - 1);
    }
  }

  const cellStyle: React.CSSProperties = {
    padding: '5px 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    color: 'var(--text)',
    outline: 'none',
    flex: 1,
    minWidth: 0,
  };

  return (
    <div
      data-testid="trait-row"
      style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}
    >
      {/* key */}
      <input
        type="text"
        aria-label={t('incarnations:traitsKeyAria')}
        placeholder={t('incarnations:traitsKeyPlaceholder')}
        value={row.key}
        onChange={(e) => onKeyChange(e.target.value)}
        style={{ ...cellStyle, maxWidth: 180 }}
      />

      {/* value area */}
      {row.mode === 'string' ? (
        <input
          type="text"
          aria-label={t('incarnations:traitsValueAria')}
          placeholder={t('incarnations:traitsValuePlaceholder')}
          value={row.strVal}
          onChange={(e) => onStrValChange(e.target.value)}
          style={cellStyle}
        />
      ) : (
        // list-mode chips
        <div
          aria-label={t('incarnations:traitsListAria')}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            padding: 5,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            flex: 1,
            minWidth: 0,
            minHeight: 34,
            alignItems: 'center',
          }}
        >
          {row.listVal.map((chip, ci) => (
            <span
              key={ci}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 5px 1px 7px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            >
              {chip}
              <button
                type="button"
                aria-label={t('incarnations:traitsChipRemove', { chip })}
                onClick={() => onRemoveChip(ci)}
                style={{
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 0,
                  display: 'inline-flex',
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={chipDraft}
            onChange={(e) => setChipDraft(e.target.value)}
            onKeyDown={onChipKey}
            onBlur={() => { if (chipDraft.trim()) { if (onAddChip(chipDraft)) setChipDraft(''); } }}
            placeholder={row.listVal.length === 0 ? t('incarnations:traitsListPlaceholder') : ''}
            style={{
              flex: 1,
              minWidth: 80,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--text)',
              padding: '2px 4px',
            }}
          />
        </div>
      )}

      {/* mode toggle */}
      <button
        type="button"
        title={row.mode === 'string' ? t('incarnations:traitsSwitchToList') : t('incarnations:traitsSwitchToString')}
        onClick={onToggleMode}
        data-testid="trait-mode-toggle"
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: row.mode === 'list' ? 'var(--surface-2)' : 'var(--surface)',
          color: 'var(--text-muted)',
          fontSize: 11,
          padding: '4px 7px',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {row.mode === 'string' ? '[ ]' : '"…"'}
      </button>

      {/* remove row */}
      <button
        type="button"
        aria-label={t('incarnations:traitsRemoveRow')}
        onClick={onRemoveRow}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'transparent',
          color: 'var(--text-muted)',
          padding: '4px 6px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
