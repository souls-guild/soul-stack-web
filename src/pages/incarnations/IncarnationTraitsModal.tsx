// Модал day-2 редактирования incarnation.traits (ADR-060).
// PUT /v1/incarnations/{name}/traits — полная замена (full-replace).
// Источник истины — incarnation.traits; проецируется в souls.traits хостов-членов.
// Примечание: GET /v1/incarnations/{name}/traits отсутствует в API → предзаполнение
// текущих значений невозможно без добавления поля traits в IncarnationGetReply (needs_backend).

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
  onClose: () => void;
}

export function IncarnationTraitsModal({ open, incarnationName, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [traits, setTraits] = useState<TraitsMap>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mu = useMutation({
    mutationFn: (body: { traits: Record<string, unknown> }) =>
      keeperApi.incarnations.setTraits(incarnationName, body),
    onSuccess: () => {
      setSaved(true);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
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
    setSaved(false);
    setTraits({});
  }

  function close() {
    resetState();
    onClose();
  }

  function submit() {
    setServerError(null);
    mu.mutate({ traits: traits as Record<string, unknown> });
  }

  if (saved) {
    return (
      <Modal
        open={open}
        title={t('incarnations:editTraitsTitle')}
        onClose={close}
        footer={
          <Button type="button" variant="primary" onClick={close}>
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
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
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
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--warning, #b5832a)',
            padding: '6px 10px',
            background: 'color-mix(in srgb, var(--warning, #b5832a) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--warning, #b5832a) 25%, var(--border))',
            borderRadius: 'var(--radius)',
          }}
        >
          {t('incarnations:editTraitsNoCurrentNote')}
        </p>
        <TraitsEditor value={traits} onChange={setTraits} />
        {serverError ? (
          <div className={styles.errorBox}>{serverError}</div>
        ) : null}
      </div>
    </Modal>
  );
}
