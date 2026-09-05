import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi, type ServiceView } from '../../api/keeper';
import { serviceEditSchema, type ServiceEditFormValues } from './schemas';
import { prettyServiceError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  service: ServiceView;
}

// PATCH /v1/services/{id} — replace semantics for the mutable fields
// (git/ref/refresh). The caption is mutable too but travels on its own
// PUT /v1/services/{id}/label, so a save that changes both is two requests; the
// id is the record key and has no edit surface at all.
export function EditServiceModal({ open, onClose, service }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ServiceEditFormValues>({
    resolver: zodResolver(serviceEditSchema),
    mode: 'onChange',
    defaultValues: {
      label: service.label ?? '',
      git: service.git,
      ref: service.ref,
      refresh: service.refresh ?? '',
    },
  });

  const mu = useMutation({
    mutationFn: async (values: ServiceEditFormValues) => {
      const git = values.git.trim();
      const ref = values.ref.trim();
      const refresh = values.refresh.trim();
      // PATCH only when a field it owns actually moved. It is not idempotent from
      // the outside: the keeper invalidates every artifact cache for the service
      // and writes a `service.updated` audit event unconditionally, so firing it
      // for a caption-only save reports a change that did not happen — and it
      // needs `service.update`, which an operator who may only set a caption
      // does not have.
      const sourceChanged =
        git !== service.git || ref !== service.ref || refresh !== (service.refresh ?? '');
      if (sourceChanged) {
        await keeperApi.services.update(service.id, {
          git,
          ref,
          ...(refresh ? { refresh } : {}),
        });
      }
      const label = values.label.trim();
      if (label !== (service.label ?? '')) {
        // null clears the caption; consumers then fall back to the id.
        await keeperApi.services.setLabel(service.id, { label: label ? label : null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', service.id] });
      qc.invalidateQueries({ queryKey: ['services.list'] });
      onClose();
    },
    onError: (err) => setServerError(prettyServiceError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:editServiceTitle', { name: service.id })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!isValid || isSubmitting || mu.isPending}
            onClick={handleSubmit((v) => {
              setServerError(null);
              mu.mutate(v);
            })}
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <Input
          label={t('common:colId')}
          mono
          readOnly
          value={service.id}
          hint={t('admin:svcIdImmutableHint')}
        />
        <div style={{ height: 12 }} />
        <Input
          label={t('common:colLabel')}
          placeholder={t('admin:svcLabelPlaceholderRedis')}
          hint={t('admin:svcLabelHint')}
          error={errors.label?.message ? t(errors.label.message) : undefined}
          {...register('label')}
        />
        <div style={{ height: 12 }} />
        <Input
          label={t('admin:svcMetaGit')}
          mono
          placeholder={t('admin:svcGitPlaceholder')}
          hint={t('admin:svcGitHintShort')}
          error={errors.git?.message ? t(errors.git.message) : undefined}
          {...register('git')}
        />
        <div style={{ height: 12 }} />
        <Input
          label={t('common:colRef')}
          mono
          placeholder={t('admin:svcRefPlaceholderMain')}
          hint={t('admin:svcRefHint')}
          error={errors.ref?.message ? t(errors.ref.message) : undefined}
          {...register('ref')}
        />
        <div style={{ height: 12 }} />
        <Input
          label={t('admin:svcRefreshLabel')}
          mono
          placeholder={t('admin:svcRefreshPlaceholder')}
          hint={t('admin:svcRefreshHintShort')}
          error={errors.refresh?.message ? t(errors.refresh.message) : undefined}
          {...register('refresh')}
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
