// Экран управления provisioning-policy операторов (ADR-058 Часть B).
// GET /v1/provisioning-policy — читаем; PUT /v1/provisioning-policy — сохраняем.
// Допустимые методы (user/ldap/oidc) — зафиксированы в ProvisioningPolicyUpdateRequest
// OpenAPI-схемой; не динамический runtime-каталог.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  keeperApi,
  type ProvisioningMethod,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button } from '../../components/primitives';
import styles from '../common.module.css';

// Полный набор допустимых методов (зафиксирован в ProvisioningPolicyUpdateRequest.allowed_methods
// enum в OpenAPI-схеме как {"user"|"ldap"|"oidc"}).
// Compile-time exhaustiveness guard: Record<ProvisioningMethod, true> требует
// КАЖДОГО члена union как ключа — добавление нового метода в OpenAPI-схему
// обновит ProvisioningMethod и сломает сборку, пока ALL_METHODS не обновлён.
const _ALL_METHODS_EXHAUSTIVE: Record<ProvisioningMethod, true> = {
  user: true,
  ldap: true,
  oidc: true,
};
const ALL_METHODS = Object.keys(_ALL_METHODS_EXHAUSTIVE) as ProvisioningMethod[];

function methodLabelKey(m: ProvisioningMethod): string {
  switch (m) {
    case 'user': return 'admin:provMethodUser';
    case 'ldap': return 'admin:provMethodLdap';
    case 'oidc': return 'admin:provMethodOidc';
  }
}

export function ProvisioningPolicy() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Локальное состояние чекбоксов — инициализируется из ответа API.
  const [selected, setSelected] = useState<Set<ProvisioningMethod>>(new Set(ALL_METHODS));
  const [initDone, setInitDone] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const policyQ = useQuery({
    queryKey: ['provisioning-policy'],
    queryFn: () => keeperApi.provisioning.getPolicy(),
    staleTime: 30_000,
  });

  // Синхронизируем чекбоксы с ответом API только при первой загрузке.
  useEffect(() => {
    if (policyQ.data && !initDone) {
      const data = policyQ.data;
      if (data.policy_set && data.allowed_methods) {
        // Фильтруем только известные UI методы (защита от неизвестных значений).
        const known = (data.allowed_methods as string[]).filter(
          (m): m is ProvisioningMethod => (ALL_METHODS as string[]).includes(m),
        );
        setSelected(new Set(known));
      } else {
        // policy_set=false → все методы разрешены (дефолт).
        setSelected(new Set(ALL_METHODS));
      }
      setInitDone(true);
    }
  }, [policyQ.data, initDone]);

  const updateMut = useMutation({
    mutationFn: () =>
      keeperApi.provisioning.updatePolicy({
        allowed_methods: Array.from(selected),
      }),
    onSuccess: () => {
      setSavedMsg(true);
      void qc.invalidateQueries({ queryKey: ['provisioning-policy'] });
      setTimeout(() => setSavedMsg(false), 3000);
    },
  });

  function toggle(m: ProvisioningMethod) {
    setSavedMsg(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(m)) {
        next.delete(m);
      } else {
        next.add(m);
      }
      return next;
    });
  }

  const isEmpty = selected.size === 0;

  return (
    <section className={styles.section} aria-label="provisioning-policy">
        <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
          {t('admin:provPolicyDesc')}
        </p>

        {policyQ.isLoading ? (
          <div className={styles.loading}>{t('loading')}</div>
        ) : policyQ.error ? (
          <div className={styles.errorBox} role="alert">
            {policyQ.error instanceof ApiError
              ? `${t('admin:provPolicyLoadError')} (${policyQ.error.status})`
              : t('admin:provPolicyLoadError')}
          </div>
        ) : (
          <>
            {policyQ.data && !policyQ.data.policy_set ? (
              <div
                role="status"
                style={{
                  marginBottom: 16,
                  padding: '8px 12px',
                  background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                {t('admin:provPolicyDefaultHint')}
              </div>
            ) : null}

            <div
              role="group"
              aria-label={t('admin:provPolicyAllowedMethods')}
              style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}
            >
              <div className={styles.metaKey} style={{ marginBottom: 4 }}>
                {t('admin:provPolicyAllowedMethods')}
              </div>
              {ALL_METHODS.map((m) => (
                <label
                  key={m}
                  data-testid={`method-label-${m}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={`method-checkbox-${m}`}
                    checked={selected.has(m)}
                    onChange={() => toggle(m)}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m}</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    — {t(methodLabelKey(m))}
                  </span>
                </label>
              ))}
            </div>

            {isEmpty ? (
              <div className={styles.errorBox} role="alert" style={{ marginBottom: 12 }}>
                {t('admin:provPolicyAntiLockout')}
              </div>
            ) : null}

            {updateMut.error ? (
              <div className={styles.errorBox} role="alert" style={{ marginBottom: 12 }}>
                {updateMut.error instanceof ApiError
                  ? `${t('admin:provPolicySaveError')} (${updateMut.error.status}: ${updateMut.error.message})`
                  : t('admin:provPolicySaveError')}
              </div>
            ) : null}

            {savedMsg ? (
              <div
                role="status"
                style={{
                  marginBottom: 12,
                  padding: '6px 12px',
                  background: 'color-mix(in srgb, var(--ok, #2d8a4e) 12%, var(--surface))',
                  border: '1px solid var(--ok, #2d8a4e)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  color: 'var(--ok, #2d8a4e)',
                }}
              >
                {t('admin:provPolicySaved')}
              </div>
            ) : null}

            <Button
              variant="primary"
              data-testid="save-policy-btn"
              disabled={isEmpty || updateMut.isPending}
              onClick={() => { setSavedMsg(false); updateMut.mutate(); }}
            >
              {updateMut.isPending ? t('admin:provPolicySaving') : t('admin:provPolicySaveBtn')}
            </Button>
          </>
        )}
    </section>
  );
}
