// Модал операционного редактирования incarnation.traits (ADR-060).
// PUT /v1/incarnations/{name}/traits — полная замена (full-replace):
// форма предзаполняется текущими traits, удаление строки удаляет trait.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { TraitsEditor, type TraitsMap } from './TraitsEditor';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  incarnationName: string;
  /** Текущие incarnation.traits (из GET-реплая) для prefill. */
  currentTraits?: Record<string, unknown> | null;
  onClose: () => void;
}

// Scalar-значения редактируются как строки (number/bool сохранятся строками).
function toTraitsMap(raw: Record<string, unknown> | null | undefined): TraitsMap {
  const out: TraitsMap = {};
  for (const [key, val] of Object.entries(raw ?? {})) {
    out[key] = Array.isArray(val) ? val.map(String) : String(val);
  }
  return out;
}

export function IncarnationTraitsModal({ open, incarnationName, currentTraits, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [traits, setTraits] = useState<TraitsMap>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed на каждом открытии до маунта TraitsEditor (он читает value один раз).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTraits(toTraitsMap(currentTraits));
      setServerError(null);
      setSaved(false);
    }
  }

  const mu = useMutation({
    mutationFn: (body: { traits: Record<string, unknown> }) =>
      keeperApi.incarnations.setTraits(incarnationName, body),
    onSuccess: () => {
      setSaved(true);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnations'] });
    },
    onError: (err) => {
      setServerError(
        err instanceof ApiError
          ? t('errors:generic', { status: err.status, detail: err.message })
          : String(err),
      );
    },
  });

  function submit() {
    setServerError(null);
    mu.mutate({ traits });
  }

  if (saved) {
    return (
      <Modal
        open={open}
        title={t('incarnations:editTraitsTitle')}
        onClose={onClose}
        footer={
          <Button type="button" variant="primary" onClick={onClose}>
            {t('souls:done')}
          </Button>
        }
      >
        <div
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--success, #2d7a4f) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--success, #2d7a4f) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            color: 'var(--success, #2d7a4f)',
            fontSize: 13,
          }}
        >
          {t('incarnations:editTraitsSuccess')}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={t('incarnations:editTraitsTitle')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={mu.isPending} onClick={submit}>
            {mu.isPending ? t('incarnations:editTraitsSaving') : t('incarnations:editTraitsSave')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('incarnations:editTraitsIntro')}
        </p>
        <TraitsEditor value={traits} onChange={setTraits} />
        {serverError ? (
          <div className={styles.errorBox}>{serverError}</div>
        ) : null}
      </div>
    </Modal>
  );
}
