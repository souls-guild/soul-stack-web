import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { applyLabelAfterCreate } from '../../api/applyLabel';
import { serviceRegisterSchema, type ServiceRegisterFormValues } from './schemas';
import { proposedId, proposedLabel } from './identity';
import { prettyServiceError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RegisterServiceModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  // The entity exists once the create returned, even if its caption write was
  // refused. Re-submitting would 409 on the id, so the only way forward is to
  // leave — the caption is editable from the entity's own page.
  const [created, setCreated] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ServiceRegisterFormValues>({
    resolver: zodResolver(serviceRegisterSchema),
    mode: 'onChange',
    defaultValues: { id: '', label: '', git: '', ref: 'main', refresh: '' },
  });

  // Which identity fields the operator has taken over. Sticky for the life of
  // the modal, and deliberately NOT react-hook-form's `dirtyFields`: that is
  // computed against the default, so clearing the field to retype it reads as
  // pristine, the proposal fires again mid-edit, and the operator ends up with
  // the proposal and their own text concatenated.
  const [taken, setTaken] = useState<{ id: boolean; label: boolean }>({ id: false, label: false });

  const git = watch('git');

  useEffect(() => {
    if (!taken.id) setValue('id', proposedId(git), { shouldValidate: true });
    if (!taken.label) setValue('label', proposedLabel(git));
  }, [git, taken.id, taken.label, setValue]);

  const idField = register('id');
  const labelField = register('label');

  const mu = useMutation({
    mutationFn: async (values: ServiceRegisterFormValues) => {
      const view = await keeperApi.services.register({
        id: values.id.trim(),
        git: values.git.trim(),
        ref: values.ref.trim(),
        // refresh is omitted rather than sent empty (openapi: absent = no auto-refresh).
        // `label` is NOT sent here even though the schema allows it — the keeper
        // drops it on create; see applyLabelAfterCreate.
        ...(values.refresh.trim() ? { refresh: values.refresh.trim() } : {}),
      });
      const labelError = await applyLabelAfterCreate(
        (body) => keeperApi.services.setLabel(view.id, body),
        values.label,
      );
      return { view, labelError };
    },
    onSuccess: ({ view, labelError }) => {
      qc.invalidateQueries({ queryKey: ['services.list'] });
      // The service exists either way; a lost caption is a notice, not a failure,
      // and re-submitting would 409 on the id.
      if (labelError) {
        setCreated(true);
        setServerError(labelError);
        return;
      }
      reset();
      setTaken({ id: false, label: false });
      onClose();
      navigate(`/services/${encodeURIComponent(view.id)}`);
    },
    onError: (err) => setServerError(prettyServiceError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    reset();
    setTaken({ id: false, label: false });
    setCreated(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('registerService')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={created || !isValid || isSubmitting || mu.isPending}
            onClick={handleSubmit((v) => {
              setServerError(null);
              mu.mutate(v);
            })}
          >
            {mu.isPending ? t('registering') : t('register')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <Input
          label={t('admin:svcMetaGit')}
          mono
          placeholder={t('admin:svcGitPlaceholder')}
          hint={t('admin:svcGitHint')}
          error={errors.git?.message ? t(errors.git.message) : undefined}
          {...register('git')}
        />
        <div style={{ height: 12 }} />
        <Input
          label={t('common:colId')}
          mono
          placeholder={t('admin:svcIdPlaceholderRedis')}
          hint={t('admin:svcIdHint')}
          error={errors.id?.message ? t(errors.id.message) : undefined}
          {...idField}
          onChange={(e) => {
            setTaken((prev) => (prev.id ? prev : { ...prev, id: true }));
            return idField.onChange(e);
          }}
        />
        <div style={{ height: 12 }} />
        <Input
          label={t('common:colLabel')}
          placeholder={t('admin:svcLabelPlaceholderRedis')}
          hint={t('admin:svcLabelHint')}
          error={errors.label?.message ? t(errors.label.message) : undefined}
          {...labelField}
          onChange={(e) => {
            setTaken((prev) => (prev.label ? prev : { ...prev, label: true }));
            return labelField.onChange(e);
          }}
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
          hint={t('admin:svcRefreshHint')}
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
