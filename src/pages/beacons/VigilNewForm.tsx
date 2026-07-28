import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type VigilCreateRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import {
  KNOWN_BEACONS,
  isKnownBeacon,
  vigilFormSchema,
  type VigilFormInput,
  fileChangedToParams,
  serviceDownToParams,
  portClosedToParams,
  processAbsentToParams,
  httpUnhealthyToParams,
} from './schemas';
import styles from '../common.module.css';

// Dynamic params form per beacon-kind. For known checks — typed fields,
// otherwise fallback to a raw-JSON textarea.
function ParamsTypedFields({
  check,
  value,
  onChange,
}: {
  check: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Record<string, unknown>) => onChange({ ...value, ...patch });

  if (check === 'core.beacon.file_changed') {
    return (
      <>
        <Input
          label="path"
          mono
          value={String(value.path ?? '')}
          onChange={(e) => set({ path: e.target.value })}
          placeholder="/etc/foo.yaml"
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>recursive</span>
          <input
            type="checkbox"
            checked={Boolean(value.recursive)}
            onChange={(e) => set({ recursive: e.target.checked })}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>
        <Input
          label="throttle"
          mono
          value={String(value.throttle ?? '')}
          onChange={(e) => set({ throttle: e.target.value })}
          placeholder={t('beacons:throttlePlaceholder')}
          hint={t('beacons:durationHint')}
        />
      </>
    );
  }
  if (check === 'core.beacon.service_down') {
    return (
      <Input
        label="service"
        mono
        value={String(value.service ?? '')}
        onChange={(e) => set({ service: e.target.value })}
        placeholder="nginx"
      />
    );
  }
  if (check === 'core.beacon.port_closed') {
    return (
      <>
        <Input
          label="host"
          mono
          value={String(value.host ?? '127.0.0.1')}
          onChange={(e) => set({ host: e.target.value })}
          placeholder="127.0.0.1"
        />
        <Input
          label="port"
          type="number"
          mono
          min={1}
          max={65535}
          value={Number(value.port ?? 0) || ''}
          onChange={(e) => set({ port: Number(e.target.value) || 0 })}
          placeholder="6379"
        />
      </>
    );
  }
  if (check === 'core.beacon.process_absent') {
    return (
      <Input
        label="process"
        mono
        value={String(value.process ?? '')}
        onChange={(e) => set({ process: e.target.value })}
        placeholder="redis-server"
      />
    );
  }
  if (check === 'core.beacon.http_unhealthy') {
    return (
      <>
        <Input
          label="url"
          mono
          value={String(value.url ?? '')}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="http://127.0.0.1:8080/health"
        />
        <Input
          label="expected_code"
          type="number"
          mono
          min={100}
          max={599}
          value={Number(value.expected_code ?? 200)}
          onChange={(e) => set({ expected_code: Number(e.target.value) || 200 })}
        />
        <Input
          label="timeout"
          mono
          value={String(value.timeout ?? '')}
          onChange={(e) => set({ timeout: e.target.value })}
          placeholder={t('beacons:timeoutPlaceholder')}
        />
      </>
    );
  }
  return null;
}

export function VigilNewForm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  // typed-params live separately — turned into params_json on submit.
  const [typedParams, setTypedParams] = useState<Record<string, unknown>>({ recursive: false });
  // covenInput — line/comma-separated; split into an array on submit.
  const [covenInput, setCovenInput] = useState('');
  // useRawParams = true → edit params manually as JSON (for unknown check).
  const [useRawParams, setUseRawParams] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<VigilFormInput>({
    resolver: zodResolver(vigilFormSchema),
    defaultValues: {
      name: '',
      interval: '30s',
      check: KNOWN_BEACONS[0],
      sid: '',
      coven: [],
      enabled: true,
      params_json: '{"recursive":false}',
    },
  });

  const check = watch('check');
  const coven = useMemo(
    () =>
      covenInput
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [covenInput],
  );

  const create = useMutation({
    mutationFn: (body: VigilCreateRequest) => keeperApi.vigils.create(body),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['vigils.list'] });
      nav(`/vigils/${encodeURIComponent(v.name)}`);
    },
    onError: (err) => {
      setServerError(
        err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err),
      );
    },
  });

  function buildParamsForSubmit(values: VigilFormInput): Record<string, unknown> {
    if (useRawParams) {
      try {
        const parsed = JSON.parse(values.params_json || '{}');
        return parsed as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (!isKnownBeacon(values.check)) {
      try {
        return JSON.parse(values.params_json || '{}') as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    // Typed mode — assemble by check.
    switch (values.check) {
      case 'core.beacon.file_changed':
        return fileChangedToParams({
          check: 'core.beacon.file_changed',
          path: String(typedParams.path ?? ''),
          recursive: Boolean(typedParams.recursive),
          throttle: typedParams.throttle ? String(typedParams.throttle) : undefined,
        });
      case 'core.beacon.service_down':
        return serviceDownToParams({
          check: 'core.beacon.service_down',
          service: String(typedParams.service ?? ''),
        });
      case 'core.beacon.port_closed':
        return portClosedToParams({
          check: 'core.beacon.port_closed',
          host: String(typedParams.host ?? '127.0.0.1'),
          port: Number(typedParams.port ?? 0),
        });
      case 'core.beacon.process_absent':
        return processAbsentToParams({
          check: 'core.beacon.process_absent',
          process: String(typedParams.process ?? ''),
        });
      case 'core.beacon.http_unhealthy':
        return httpUnhealthyToParams({
          check: 'core.beacon.http_unhealthy',
          url: String(typedParams.url ?? ''),
          expected_code: Number(typedParams.expected_code ?? 200),
          timeout: typedParams.timeout ? String(typedParams.timeout) : undefined,
        });
    }
  }

  function onSubmit(values: VigilFormInput) {
    setServerError(null);
    const params = buildParamsForSubmit(values);
    const body: VigilCreateRequest = {
      name: values.name,
      interval: values.interval,
      check: values.check,
      params: params as VigilCreateRequest['params'],
      enabled: values.enabled,
    };
    if (values.sid) body.sid = values.sid;
    else if (coven.length > 0) body.coven = coven;
    create.mutate(body);
  }

  // When switching check, reset typedParams to sensible defaults.
  function onCheckChange(next: string) {
    setValue('check', next, { shouldValidate: true });
    if (next === 'core.beacon.file_changed') setTypedParams({ recursive: false });
    else if (next === 'core.beacon.port_closed') setTypedParams({ host: '127.0.0.1' });
    else if (next === 'core.beacon.http_unhealthy') setTypedParams({ expected_code: 200 });
    else setTypedParams({});
  }

  // Sync coven from the text field into the form, so the validator sees it.
  // (we don't validate coven separately — we take it via useMemo on submit).
  function syncCovenToForm() {
    setValue('coven', coven, { shouldValidate: false });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.crumbs}>
            <a href="/vigils" onClick={(e) => { e.preventDefault(); nav('/vigils'); }}>vigils</a> / {t('crumbNew')}
          </div>
          <h1 className={styles.title}>{t('beacons:newVigilTitle')}</h1>
          <div className={styles.crumbs}>{t('beacons:newVigilSubtitle')}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <section className={styles.section} aria-label={t('beacons:baseFieldsLegend')}>
          <h2 className={styles.sectionTitle}>{t('beacons:baseFieldsLegend')}</h2>
          <div className={styles.formFields}>
            <Input
              label="Name (kebab-case)"
              mono
              {...register('name')}
              placeholder="redis-down"
              error={errors.name?.message ? t(errors.name.message) : undefined}
            />
            <Input
              label="Interval"
              mono
              {...register('interval')}
              placeholder="30s"
              hint={t('beacons:durationHint')}
              error={errors.interval?.message ? t(errors.interval.message) : undefined}
            />
            <label>
              <div className={styles.metaKey}>{t('colBeaconKind')}</div>
              <select
                value={check}
                onChange={(e) => onCheckChange(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {KNOWN_BEACONS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              {errors.check ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.check.message ?? '')}</span>
              ) : null}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className={styles.metaKey}>Enabled</span>
              <input
                type="checkbox"
                {...register('enabled')}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
            </label>
          </div>
        </section>

        <section className={styles.section} aria-label={t('beacons:subjectXorLegend')}>
          <h2 className={styles.sectionTitle}>{t('colSubject')}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('beacons:subjectVigilHint', { sid: 'sid', coven: 'coven' })}
          </div>
          <div className={styles.formFields}>
            <Input
              label="sid (FQDN)"
              mono
              {...register('sid')}
              placeholder="host01.example.com"
              error={errors.sid?.message ? t(errors.sid.message) : undefined}
              disabled={coven.length > 0}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
              <span className={styles.metaKey}>{t('beacons:covenSpaceComma')}</span>
              <input
                value={covenInput}
                onChange={(e) => { setCovenInput(e.target.value); }}
                onBlur={syncCovenToForm}
                placeholder={t('beacons:covenPlaceholder')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                }}
                disabled={Boolean(watch('sid'))}
              />
              <span className={styles.metaKey}>{t('beacons:covenTagCount', { count: coven.length })}</span>
            </label>
          </div>
        </section>

        <section className={styles.section} aria-label="Params">
          <h2 className={styles.sectionTitle}>{t('colParams')}</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={useRawParams}
              onChange={(e) => setUseRawParams(e.target.checked)}
            />
            {t('beacons:rawJsonToggle')}
          </label>
          {useRawParams || !isKnownBeacon(check) ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className={styles.metaKey}>{t('beacons:paramsJsonLabel')}</span>
              <textarea
                {...register('params_json')}
                rows={6}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                  padding: 8,
                  background: 'var(--surface)',
                  border: `1px solid ${errors.params_json ? 'var(--danger)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  resize: 'vertical',
                }}
                placeholder='{"path": "/etc/foo"}'
              />
              {errors.params_json ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.params_json.message ?? '')}</span>
              ) : null}
            </label>
          ) : (
            <div className={styles.formFields}>
              <ParamsTypedFields check={check} value={typedParams} onChange={setTypedParams} />
            </div>
          )}
        </section>

        {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="primary" disabled={isSubmitting || create.isPending}>
            {create.isPending ? t('creating') : t('createVigil')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => nav('/vigils')}>{t('cancel')}</Button>
        </div>
      </form>
    </div>
  );
}
