import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type ProviderCreateRequest } from '../../api/keeper';
import { Modal, Button, Input } from '../../components/primitives';
import { SecretModeField } from '../../components/input/SecretModeField';
import type { SecretMode } from '../../components/input/secretMode';
import { prettyProviderError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Парсит "key: value" построчно в объект credentials. Строки без ':' игнорируются. */
function parseKV(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

const NAME_PATTERN = /^[a-z0-9-]{1,63}$/;

export function ProviderCreateModal({ open, onClose }: Props) {
  const { t } = useTranslation(['providers', 'common', 'forms']);
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [region, setRegion] = useState('');
  const [fqdnSuffix, setFqdnSuffix] = useState('');
  // credentials — dual-mode: значение (KV-объект) XOR credentials_ref (vault-путь).
  const [credMode, setCredMode] = useState<SecretMode>('ref');
  const [credValue, setCredValue] = useState(''); // KV-текст "key: value"
  const [credRef, setCredRef] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('');
    setRegion('');
    setFqdnSuffix('');
    setCredMode('ref');
    setCredValue('');
    setCredRef('');
  }, [open]);

  const createMu = useMutation({
    mutationFn: (body: ProviderCreateRequest) => keeperApi.providers.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers.list'] });
      onClose();
    },
  });

  const credObject = parseKV(credValue);
  const credProvided = credMode === 'value' ? Object.keys(credObject).length > 0 : credRef.trim() !== '';
  const canSubmit =
    NAME_PATTERN.test(name) && NAME_PATTERN.test(type) && region.trim() !== '' && credProvided;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // credentials XOR credentials_ref — шлём поле активного режима (ADR-064).
    const body: ProviderCreateRequest = {
      name,
      type,
      region: region.trim(),
      fqdn_suffix: fqdnSuffix.trim() || undefined,
      credentials: credMode === 'value' ? (credObject as ProviderCreateRequest['credentials']) : undefined,
      credentials_ref: credMode === 'ref' ? credRef.trim() || undefined : undefined,
    };
    createMu.mutate(body);
  }

  return (
    <Modal open={open} title={t('providers:createTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('providers:fieldName')} *</span>
          <Input
            data-testid="provider-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="aws-eu"
            required
            pattern="^[a-z0-9-]{1,63}$"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('providers:fieldNameHint')}</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('providers:fieldType')} *</span>
          <Input
            data-testid="provider-type-input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="community-aws"
            required
            pattern="^[a-z0-9-]{1,63}$"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('providers:fieldTypeHint')}</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('providers:fieldRegion')} *</span>
          <Input
            data-testid="provider-region-input"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="eu-central-1"
            required
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('providers:fieldFqdnSuffix')}</span>
          <Input
            data-testid="provider-fqdn-input"
            value={fqdnSuffix}
            onChange={(e) => setFqdnSuffix(e.target.value)}
            placeholder="cloud.example.com"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('providers:fieldFqdnSuffixHint')}</span>
        </label>

        <SecretModeField
          label={t('providers:fieldCredentials')}
          required
          mode={credMode}
          onModeChange={setCredMode}
          testIdBase="provider-credentials"
          valueModeLabel={t('providers:secretModeValue')}
          refModeLabel={t('providers:secretModeRef')}
          renderValue={({ testId }) => (
            <>
              <textarea
                data-testid={testId}
                value={credValue}
                onChange={(e) => setCredValue(e.target.value)}
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
          refValue={credRef}
          onRefChange={setCredRef}
          refType="text"
          refPlaceholder="vault:secret/cloud/aws-eu"
          refHint={t('providers:fieldCredentialsRefHint')}
        />

        {createMu.isError ? (
          <div role="alert" className={styles.errorBox} data-testid="provider-form-error">
            {prettyProviderError(createMu.error)}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={createMu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={createMu.isPending || !canSubmit}>
            {t('common:create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
