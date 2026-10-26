// "Change owner" on a machine operator's card: PUT /v1/operators/{aid}/owner with
// exactly one of owner_aid / owner_synod (operator.set-owner). The Keeper's 422
// says what is wrong with the owner, so its detail is shown as it is.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type Operator } from '../../api/keeper';
import { Button, Modal } from '../../components/primitives';
import { OwnerPicker } from './OwnerPicker';
import { ownerBody, ownerErrorText } from './owner';
import { ownerSchema, type OwnerFormValues } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  op: Operator;
  onClose: () => void;
}

export function SetOwnerModal({ open, op, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState: { errors } } = useForm<OwnerFormValues>({
    resolver: zodResolver(ownerSchema),
    values: op.owner_synod ? { kind: 'synod', value: op.owner_synod } : { kind: 'archon', value: op.owner_aid ?? '' },
  });

  const mu = useMutation({
    mutationFn: (v: OwnerFormValues) => keeperApi.operators.setOwner(op.aid, ownerBody(v.kind, v.value.trim())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operator', op.aid] });
      qc.invalidateQueries({ queryKey: ['operators.list'] });
      close();
    },
    onError: (err) => setServerError(ownerErrorText(err)),
  });

  function close() {
    setServerError(null);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('pages:archonOwnerChangeTitle', { aid: op.aid })}
      onClose={() => {
        if (!mu.isPending) close();
      }}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="set-owner-form" variant="primary" disabled={mu.isPending} data-testid="owner-set-submit">
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form
        id="set-owner-form"
        className={styles.formFields}
        onSubmit={handleSubmit((v) => {
          setServerError(null);
          mu.mutate(v);
        })}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('pages:archonOwnerHint')}</p>
        <Controller
          control={control}
          name="kind"
          render={({ field: kindField }) => (
            <Controller
              control={control}
              name="value"
              render={({ field: valueField }) => (
                <OwnerPicker
                  kind={kindField.value}
                  value={valueField.value}
                  onKindChange={(k) => kindField.onChange(k || 'archon')}
                  onValueChange={valueField.onChange}
                  enabled={open}
                  error={errors.value?.message ? t(errors.value.message) : undefined}
                  testidPrefix="owner-set"
                />
              )}
            />
          )}
        />
        {serverError ? (
          <div className={styles.errorBox} role="alert" data-testid="owner-set-error">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
