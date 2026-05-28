import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { ChipsInput } from '../incarnations/ChipsInput';
import {
  keeperApi,
  type SoulCovenAssignReply,
  type SoulCovenAssignRequest,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { COVEN_PATTERN } from './schemas';
import styles from '../common.module.css';

type Mode = 'append' | 'remove' | 'replace';

// Два режима модалки:
//   - single: правка ковенов одного Soul (на странице detail). Селектор —
//     {sids: [sid]}. Чаще всего mode=replace с новым набором.
//   - bulk: массовая операция из списка с multi-select. Селектор —
//     {sids: [<selected>]}, оператор выбирает mode + одну label (append/remove)
//     или набор labels (replace).
//
// API: POST /v1/souls/coven с SoulCovenAssignRequest. Ответ — SoulCovenAssignReply
// с matched/changed/status (completed|partial). При partial показываем warning.
interface Props {
  open: boolean;
  onClose: () => void;
  // single — текущие covens конкретной Soul, для preview chips.
  variant:
    | { kind: 'single'; sid: string; currentCovens: string[] }
    | { kind: 'bulk'; sids: string[] };
}

function validateCoven(v: string): string | null {
  if (!COVEN_PATTERN.test(v)) return 'lowercase, цифры, дефис-разделитель';
  if (v.length > 63) return 'не длиннее 63 символов';
  return null;
}

export function CovenAssignModal({ open, onClose, variant }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(variant.kind === 'single' ? 'replace' : 'append');
  const [label, setLabel] = useState('');
  const [labels, setLabels] = useState<string[]>(
    variant.kind === 'single' ? [...variant.currentCovens] : [],
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [reply, setReply] = useState<SoulCovenAssignReply | null>(null);

  const mu = useMutation({
    mutationFn: (body: SoulCovenAssignRequest) => keeperApi.souls.bulkAssignCoven(body),
    onSuccess: (r) => {
      setReply(r);
      setServerError(null);
      // Инвалидируем кэш и detail, и list-а — оба зависят от covens.
      qc.invalidateQueries({ queryKey: ['souls'] });
      if (variant.kind === 'single') {
        qc.invalidateQueries({ queryKey: ['soul', variant.sid] });
      }
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function close() {
    setServerError(null);
    setReply(null);
    setMode(variant.kind === 'single' ? 'replace' : 'append');
    setLabel('');
    setLabels(variant.kind === 'single' ? [...variant.currentCovens] : []);
    onClose();
  }

  function submit() {
    setServerError(null);
    const sids = variant.kind === 'single' ? [variant.sid] : variant.sids;
    if (sids.length === 0) {
      setServerError(t('errors:noSoulSelected'));
      return;
    }
    const base: SoulCovenAssignRequest = {
      mode,
      selector: { all: false, sids },
      dry_run: false,
    };
    if (mode === 'replace') {
      mu.mutate({ ...base, labels });
    } else {
      const v = label.trim();
      if (!v) {
        setServerError(t('errors:oneLabelForAppendRemove'));
        return;
      }
      const reason = validateCoven(v);
      if (reason) {
        setServerError(reason);
        return;
      }
      mu.mutate({ ...base, label: v });
    }
  }

  const targetCount = variant.kind === 'single' ? 1 : variant.sids.length;
  const title =
    variant.kind === 'single'
      ? `Coven assignment: ${variant.sid}`
      : `Bulk coven-assign: ${targetCount} Soul${targetCount === 1 ? '' : 's'}`;

  // Success state — показываем reply matched/changed/status.
  if (reply) {
    return (
      <Modal
        open={open}
        title={title}
        onClose={close}
        footer={
          <Button type="button" variant="primary" onClick={close}>
            Готово
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
            partial — часть чанков закоммичена до фейла. Повторите операцию (идемпотентна).
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
          {reply.mode === 'replace' ? (
            <>
              <span className={styles.metaKey}>labels</span>
              <span className={styles.metaVal}>{(reply.labels ?? []).join(', ') || '— (снято всё)'}</span>
            </>
          ) : (
            <>
              <span className={styles.metaKey}>label</span>
              <span className={styles.metaVal}>{reply.label}</span>
            </>
          )}
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
        {variant.kind === 'bulk' ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Будут применены к {targetCount} Soul-ам. Селектор — точечный список SID.
          </p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Текущий набор Coven-меток предзаполнен. Удалите / добавьте, выберите mode и применяйте.
          </p>
        )}

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          <legend style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 6px' }}>mode</legend>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
            <input
              type="radio"
              name="mode"
              value="append"
              checked={mode === 'append'}
              onChange={() => setMode('append')}
            />
            <span>append (одна метка)</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
            <input
              type="radio"
              name="mode"
              value="remove"
              checked={mode === 'remove'}
              onChange={() => setMode('remove')}
            />
            <span>remove (одна метка)</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            <span>replace (набор)</span>
          </label>
        </fieldset>

        {mode === 'replace' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13 }}>Coven-метки (пустой набор = снять все)</span>
            <ChipsInput
              value={labels}
              onChange={setLabels}
              placeholder="prod, redis-prod, ..."
              validate={validateCoven}
              ariaLabel="coven-метки"
            />
          </label>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13 }}>Coven-метка</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="prod"
              spellCheck={false}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
              }}
            />
          </label>
        )}

        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}
