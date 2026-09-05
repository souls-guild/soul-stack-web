import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from './primitives';
import { ApiError } from '../api/client';
import type { LabelSetRequest } from '../api/keeper';
import styles from '../pages/common.module.css';

// The caption is the only half of a registry entity's identity that can change,
// and for several registries it is the only mutable field there is — so it needs
// an edit surface of its own rather than riding on an entity form that does not
// exist. `PUT /v1/<registry>/{id}/label` is what it writes.
//
// The id is shown read-only beside it: this is the one screen where an operator
// is deciding what to call something, and the immutable half belongs in view so
// the difference between the two is visible rather than asserted.
export function EditLabelModal({
  open,
  onClose,
  id,
  label,
  setLabel,
  invalidate,
  idHint,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  label: string | undefined;
  setLabel: (body: LabelSetRequest) => Promise<unknown>;
  /** Query keys to invalidate once the caption has moved. */
  invalidate: readonly unknown[][];
  /** Why the id cannot be edited, in the entity's own terms. */
  idHint: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [value, setValue] = useState(label ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  // Re-seed on open. `id` is in the deps as well as `label`: two entities that
  // both lack a caption seed the same empty string, so keying on the caption
  // alone would carry typed text from one entity to the next if a list ever
  // reused a single open instance.
  useEffect(() => {
    if (open) {
      setValue(label ?? '');
      setServerError(null);
    }
  }, [open, id, label]);

  const mu = useMutation({
    // An empty field clears the caption — null, not "", because the contract reads
    // null as "cleared, show the id" and would store the empty string verbatim.
    mutationFn: () => setLabel({ label: value.trim() ? value.trim() : null }),
    onSuccess: () => {
      for (const key of invalidate) qc.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: (err) =>
      setServerError(
        err instanceof ApiError
          ? t('errors:generic', { status: err.status, detail: err.detail || err.message })
          : String(err),
      ),
  });

  function close() {
    if (mu.isPending) return;
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:editLabelTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mu.isPending}
            data-testid="edit-label-save"
            onClick={() => {
              setServerError(null);
              mu.mutate();
            }}
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <Input label={t('common:colId')} mono readOnly value={id} hint={idHint} />
        <div style={{ height: 12 }} />
        <Input
          label={t('common:colLabel')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          hint={t('forms:editLabelHint')}
          data-testid="edit-label-input"
        />
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
