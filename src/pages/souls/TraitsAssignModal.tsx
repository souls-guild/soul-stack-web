import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import {
  keeperApi,
  type SoulTraitsAssignReply,
  type SoulTraitsAssignRequest,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

type TraitMode = 'merge' | 'replace' | 'remove';

// Two forms:
//   - single: edit a trait on one Soul (SoulDetail). Mode: merge or replace.
//   - bulk:   bulk operation from the list with multi-select. Modes: all three.
//
// API: POST /v1/souls/traits. Shape: merge/replace -> traits-map;
// remove -> keys. dry_run is optional (not exposed from the UI).
// Permission soul.traits-assign.
interface Props {
  open: boolean;
  onClose: () => void;
  variant:
    | { kind: 'single'; sid: string }
    | { kind: 'bulk'; sids: string[] };
}

// A pair for the trait-entry editor.
type TraitPair = { key: string; value: string };

// Trait key validation: kebab/snake-case ([a-z][a-z0-9]*([_-][a-z0-9]+)*) -- NIM-67, mirrors soul.TraitKeyPattern.
const TRAIT_KEY_PATTERN = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/;

function validateTraitKey(k: string): string | null {
  if (!TRAIT_KEY_PATTERN.test(k)) return 'souls:traitKeyInvalid';
  return null;
}

// Unpack a set of pairs into a map (last key wins).
function pairsToMap(pairs: TraitPair[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of pairs) {
    if (key.trim() !== '') {
      // If the value looks like a JSON array -- parse into a list. Otherwise a scalar string.
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try {
          const arr = JSON.parse(trimmed);
          if (Array.isArray(arr)) {
            out[key] = arr;
            continue;
          }
        } catch { /* ignore */ }
      }
      out[key] = trimmed;
    }
  }
  return out;
}

export function TraitsAssignModal({ open, onClose, variant }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<TraitMode>(variant.kind === 'single' ? 'merge' : 'merge');
  const [pairs, setPairs] = useState<TraitPair[]>([{ key: '', value: '' }]);
  const [removeKeys, setRemoveKeys] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [reply, setReply] = useState<SoulTraitsAssignReply | null>(null);

  const mu = useMutation({
    mutationFn: (body: SoulTraitsAssignRequest) => keeperApi.souls.assignTraits(body),
    onSuccess: (r) => {
      setReply(r);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ['souls'] });
      if (variant.kind === 'single') {
        qc.invalidateQueries({ queryKey: ['soul', variant.sid] });
      }
    },
    onError: (err) => {
      setServerError(
        err instanceof ApiError
          ? t('errors:generic', { status: err.status, detail: err.message })
          : String(err),
      );
    },
  });

  function resetState() {
    setServerError(null);
    setReply(null);
    setMode('merge');
    setPairs([{ key: '', value: '' }]);
    setRemoveKeys('');
  }

  function close() {
    resetState();
    onClose();
  }

  function submit() {
    setServerError(null);
    const sids = variant.kind === 'single' ? [variant.sid] : variant.sids;
    if (sids.length === 0) {
      setServerError(t('errors:noSoulSelected'));
      return;
    }

    const selector = { sids };

    if (mode === 'remove') {
      const keys = removeKeys
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      if (keys.length === 0) {
        setServerError(t('souls:traitKeysRequired'));
        return;
      }
      for (const k of keys) {
        const err = validateTraitKey(k);
        if (err) {
          setServerError(t(err));
          return;
        }
      }
      mu.mutate({ mode: 'remove', selector, keys });
      return;
    }

    // merge / replace -- validate the pairs.
    const validPairs = pairs.filter((p) => p.key.trim() !== '');
    if (validPairs.length === 0 && mode === 'replace') {
      // replace with an empty map -- allowed (clears all traits).
    }
    for (const { key } of validPairs) {
      const err = validateTraitKey(key);
      if (err) {
        setServerError(t(err));
        return;
      }
    }
    const traits = pairsToMap(validPairs);
    mu.mutate({ mode, selector, traits });
  }

  const targetCount = variant.kind === 'single' ? 1 : variant.sids.length;
  const title =
    variant.kind === 'single'
      ? `${t('souls:traitAssignment')}: ${variant.sid}`
      : t('souls:bulkTraitTitle', { count: targetCount, noun: targetCount === 1 ? 'Soul' : 'Souls' });

  // Success -- show matched/changed/status.
  if (reply) {
    return (
      <Modal
        open={open}
        title={title}
        onClose={close}
        footer={
          <Button type="button" variant="primary" onClick={close}>
            {t('souls:done')}
          </Button>
        }
      >
        {reply.status === 'partial' ? (
          <div
            style={{
              padding: 'var(--s-3) var(--s-4)',
              background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
              borderRadius: 'var(--radius)',
              color: 'var(--warning)',
              fontSize: 12.5,
              marginBottom: 12,
            }}
          >
            {t('souls:traitPartialWarn')}
          </div>
        ) : null}
        <div className={styles.meta}>
          <span className={styles.metaKey}>mode</span>
          <span className={styles.metaVal}>{reply.mode}</span>
          <span className={styles.metaKey}>status</span>
          <span className={styles.metaVal}>{reply.status}</span>
          <span className={styles.metaKey}>matched</span>
          <span className={styles.metaVal}>{reply.matched}</span>
          <span className={styles.metaKey}>changed</span>
          <span className={styles.metaVal}>{reply.changed}</span>
          <span className={styles.metaKey}>keys</span>
          <span className={styles.metaVal}>{(reply.keys ?? []).join(', ') || '—'}</span>
          <span className={styles.metaKey}>dry_run</span>
          <span className={styles.metaVal}>{String(reply.dry_run)}</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={mu.isPending} onClick={submit}>
            {mu.isPending ? t('applying') : t('apply')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {variant.kind === 'bulk'
            ? t('souls:bulkTraitIntro', { count: targetCount })
            : t('souls:singleTraitIntro')}
        </p>

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          <legend style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 6px' }}>mode</legend>
          {(['merge', 'replace', 'remove'] as const).map((m) => (
            <label
              key={m}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}
            >
              <input
                type="radio"
                name="traitMode"
                value={m}
                data-testid={`trait-mode-${m}`}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span>{t(`souls:traitMode${m.charAt(0).toUpperCase() + m.slice(1)}` as const)}</span>
            </label>
          ))}
        </fieldset>

        {mode === 'remove' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13 }}>{t('souls:traitRemoveKeysLabel')}</span>
            <input
              type="text"
              data-testid="trait-remove-keys"
              value={removeKeys}
              onChange={(e) => setRemoveKeys(e.target.value)}
              placeholder="namespace, tier"
              spellCheck={false}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('souls:traitRemoveKeysHint')}
            </span>
          </label>
        ) : (
          <TraitPairsEditor pairs={pairs} onChange={setPairs} />
        )}

        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }}>
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

// Editor for trait pairs (merge/replace modes).
// Each pair: key (kebab-case) -> value (scalar string or JSON-list).
interface PairsEditorProps {
  pairs: TraitPair[];
  onChange: (next: TraitPair[]) => void;
}

function TraitPairsEditor({ pairs, onChange }: PairsEditorProps) {
  const { t } = useTranslation();
  const baseInputStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
  };

  function handleKeyChange(idx: number, key: string) {
    const next = [...pairs];
    next[idx] = { ...next[idx], key };
    onChange(next);
  }

  function handleValChange(idx: number, value: string) {
    const next = [...pairs];
    next[idx] = { ...next[idx], value };
    onChange(next);
  }

  function handleAdd() {
    onChange([...pairs, { key: '', value: '' }]);
  }

  function handleRemove(idx: number) {
    const next = pairs.filter((_, i) => i !== idx);
    onChange(next.length === 0 ? [{ key: '', value: '' }] : next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13 }}>{t('souls:traitPairsLabel')}</span>
      {pairs.map((pair, idx) => {
        const keyErr = pair.key.trim() !== '' ? validateTraitKey(pair.key) : null;
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                data-testid={`trait-key-${idx}`}
                value={pair.key}
                onChange={(e) => handleKeyChange(idx, e.target.value)}
                placeholder="namespace"
                spellCheck={false}
                style={{ ...baseInputStyle, flex: '0 0 160px', borderColor: keyErr ? 'var(--danger)' : 'var(--border)' }}
              />
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>→</span>
              <input
                type="text"
                data-testid={`trait-val-${idx}`}
                value={pair.value}
                onChange={(e) => handleValChange(idx, e.target.value)}
                placeholder={t('souls:traitValuePlaceholder')}
                spellCheck={false}
                style={{ ...baseInputStyle, flex: 1 }}
              />
              <button
                type="button"
                data-testid={`trait-remove-${idx}`}
                onClick={() => handleRemove(idx)}
                title={t('souls:traitRemovePair')}
                style={{
                  padding: '4px 8px',
                  fontSize: 14,
                  cursor: 'pointer',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                {t('souls:traitRemovePair')}
              </button>
            </div>
            {keyErr ? (
              <span style={{ color: 'var(--danger)', fontSize: 12, paddingLeft: 2 }}>
                {t(keyErr)}
              </span>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        data-testid="trait-add-pair"
        onClick={handleAdd}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 10px',
          fontSize: 13,
          cursor: 'pointer',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        + {t('souls:traitAddPair')}
      </button>
      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        {t('souls:traitValueHint')}
      </span>
    </div>
  );
}
