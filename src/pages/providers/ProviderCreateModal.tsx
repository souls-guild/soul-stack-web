import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type ProviderCreateRequest } from '../../api/keeper';
import { Modal, Button, Input } from '../../components/primitives';
import { SecretModeField } from '../../components/input/SecretModeField';
import { providerCreateSchema, parseCredentialsKV, type ProviderCreateFormValues } from './schemas';
import { prettyProviderError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const DEFAULTS: ProviderCreateFormValues = {
  name: '',
  type: '',
  region: '',
  fqdnSuffix: '',
  credMode: 'ref',
  credValue: '',
  credRef: '',
};

export function ProviderCreateModal({ open, onClose }: Props) {
  const { t } = useTranslation(['providers', 'common', 'forms']);
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ProviderCreateFormValues>({
    resolver: zodResolver(providerCreateSchema),
    mode: 'onChange',
    defaultValues: DEFAULTS,
  });

  const createMu = useMutation({
    mutationFn: (body: ProviderCreateRequest) => keeperApi.providers.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers.list'] });
      reset(DEFAULTS);
      onClose();
    },
    onError: (err) => setServerError(prettyProviderError(err)),
  });

  function close() {
    if (createMu.isPending) return;
    setServerError(null);
    reset(DEFAULTS);
    onClose();
  }

  const onValid = (v: ProviderCreateFormValues) => {
    setServerError(null);
    // credentials XOR credentials_ref — шлём поле активного режима (ADR-064).
    const body: ProviderCreateRequest = {
      name: v.name,
      type: v.type,
      region: v.region,
      fqdn_suffix: v.fqdnSuffix || undefined,
      credentials: v.credMode === 'value' ? (parseCredentialsKV(v.credValue) as ProviderCreateRequest['credentials']) : undefined,
      credentials_ref: v.credMode === 'ref' ? v.credRef.trim() || undefined : undefined,
    };
    createMu.mutate(body);
  };

  const credMode = watch('credMode');
  const credError = errors.credValue?.message ?? errors.credRef?.message;

  return (
    <Modal
      open={open}
      title={t('providers:createTitle')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={close} disabled={isSubmitting || createMu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!isValid || isSubmitting || createMu.isPending}
            onClick={handleSubmit(onValid)}
          >
            {t('common:create')}
          </Button>
        </>
      }
    >
      <form noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input
          data-testid="provider-name-input"
          label={`${t('providers:fieldName')} *`}
          hint={t('providers:fieldNameHint')}
          placeholder="aws-eu"
          error={errors.name?.message ? t(errors.name.message) : undefined}
          {...register('name')}
        />
        <Input
          data-testid="provider-type-input"
          label={`${t('providers:fieldType')} *`}
          hint={t('providers:fieldTypeHint')}
          placeholder="community-aws"
          error={errors.type?.message ? t(errors.type.message) : undefined}
          {...register('type')}
        />
        <Input
          data-testid="provider-region-input"
          label={`${t('providers:fieldRegion')} *`}
          placeholder="eu-central-1"
          error={errors.region?.message ? t(errors.region.message) : undefined}
          {...register('region')}
        />
        <Input
          data-testid="provider-fqdn-input"
          label={t('providers:fieldFqdnSuffix')}
          hint={t('providers:fieldFqdnSuffixHint')}
          placeholder="cloud.example.com"
          {...register('fqdnSuffix')}
        />

        <div>
          <SecretModeField
            label={t('providers:fieldCredentials')}
            required
            mode={credMode}
            onModeChange={(m) => setValue('credMode', m, { shouldValidate: true })}
            testIdBase="provider-credentials"
            valueModeLabel={t('providers:secretModeValue')}
            refModeLabel={t('providers:secretModeRef')}
            renderValue={({ testId }) => (
              <>
                <textarea
                  data-testid={testId}
                  value={watch('credValue')}
                  onChange={(e) => setValue('credValue', e.target.value, { shouldValidate: true })}
                  placeholder={'access_key: AKIA…\nsecret_key: …'}
                  rows={3}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    resize: 'vertical',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('providers:fieldCredentialsValueHint')}</span>
              </>
            )}
            refValue={watch('credRef')}
            onRefChange={(v) => setValue('credRef', v, { shouldValidate: true })}
            refType="text"
            refPlaceholder="vault:secret/cloud/aws-eu"
            refHint={t('providers:fieldCredentialsRefHint')}
          />
          {credError ? (
            <span data-testid="provider-credentials-error" style={{ fontSize: 12, color: 'var(--danger)' }}>
              {t(credError)}
            </span>
          ) : null}
        </div>

        {serverError ? (
          <div role="alert" className={styles.errorBox} data-testid="provider-form-error">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
