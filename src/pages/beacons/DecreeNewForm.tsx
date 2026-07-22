import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type DecreeCreateRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import { decreeFormSchema, type DecreeFormInput } from './schemas';
import styles from '../common.module.css';

export function DecreeNewForm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [covenInput, setCovenInput] = useState('');

  // Pull in the list of Vigils and Incarnations for UX (datalist).
  const vigils = useQuery({
    queryKey: ['vigils.list', { limit: 200, offset: 0 }],
    queryFn: () => keeperApi.vigils.list({ limit: 200 }),
  });
  const incarnations = useQuery({
    queryKey: ['incarnations.list', { limit: 200, offset: 0 }],
    queryFn: () => keeperApi.incarnations.list({ limit: 200 }),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DecreeFormInput>({
    resolver: zodResolver(decreeFormSchema),
    defaultValues: {
      name: '',
      on_beacon: '',
      where: '',
      sid: '',
      coven: [],
      incarnation_name: '',
      action_scenario: '',
      action_input_json: '{}',
      cooldown: '',
      enabled: false, // default-deny, operator enables explicitly.
    },
  });

  const coven = useMemo(
    () =>
      covenInput
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [covenInput],
  );

  const create = useMutation({
    mutationFn: (body: DecreeCreateRequest) => keeperApi.decrees.create(body),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['decrees.list'] });
      nav(`/decrees/${encodeURIComponent(d.name)}`);
    },
    onError: (err) => {
      setServerError(
        err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err),
      );
    },
  });

  function onSubmit(values: DecreeFormInput) {
    setServerError(null);
    let actionInput: Record<string, unknown> = {};
    try {
      actionInput = JSON.parse(values.action_input_json || '{}') as Record<string, unknown>;
    } catch {
      actionInput = {};
    }
    const body: DecreeCreateRequest = {
      name: values.name,
      on_beacon: values.on_beacon,
      incarnation_name: values.incarnation_name,
      action_scenario: values.action_scenario,
      action_input: actionInput as DecreeCreateRequest['action_input'],
      enabled: values.enabled,
    };
    if (values.where) body.where = values.where;
    if (values.cooldown) body.cooldown = values.cooldown;
    if (values.sid) body.sid = values.sid;
    else if (coven.length > 0) body.coven = coven;
    create.mutate(body);
  }

  function syncCovenToForm() {
    setValue('coven', coven, { shouldValidate: false });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.crumbs}>
            <a href="/decrees" onClick={(e) => { e.preventDefault(); nav('/decrees'); }}>decrees</a> / new
          </div>
          <h1 className={styles.title}>New Decree</h1>
          <div className={styles.crumbs}>{t('beacons:newDecreeSubtitle')}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <section className={styles.section} aria-label={t('beacons:baseFieldsLegend')}>
          <h2 className={styles.sectionTitle}>{t('beacons:baseFieldsLegend')}</h2>
          <div className={styles.filters}>
            <Input
              label="Name (kebab-case)"
              mono
              {...register('name')}
              placeholder="restart-on-config-change"
              error={errors.name?.message ? t(errors.name.message) : undefined}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className={styles.metaKey}>{t('beacons:onBeaconLabel')}</div>
              <input
                list="known-vigils"
                {...register('on_beacon')}
                placeholder="redis-config-changed"
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  border: `1px solid ${errors.on_beacon ? 'var(--danger)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  minWidth: 220,
                }}
              />
              <datalist id="known-vigils">
                {(vigils.data?.items ?? []).map((v) => <option key={v.name} value={v.name} />)}
              </datalist>
              {errors.on_beacon ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.on_beacon.message ?? '')}</span>
              ) : null}
            </label>
            <Input
              label="Cooldown"
              mono
              {...register('cooldown')}
              placeholder={t('beacons:cooldownPlaceholder')}
              hint={t('beacons:durationHint')}
              error={errors.cooldown?.message ? t(errors.cooldown.message) : undefined}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className={styles.metaKey}>Enabled (default-deny)</span>
              <input
                type="checkbox"
                {...register('enabled')}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
            </label>
          </div>
        </section>

        <section className={styles.section} aria-label="CEL where">
          <h2 className={styles.sectionTitle}>{t('beacons:celWhereOptional')}</h2>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={styles.metaKey}>{t('beacons:celWhereHint')}</span>
            <textarea
              {...register('where')}
              rows={3}
              placeholder='portent.kind == "core.beacon.file_changed" && portent.path == "/etc/redis.conf"'
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
                padding: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                resize: 'vertical',
              }}
            />
          </label>
        </section>

        <section className={styles.section} aria-label={t('beacons:subjectXorLegend')}>
          <h2 className={styles.sectionTitle}>Subject</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('beacons:subjectDecreeHint', { sid: 'sid', coven: 'coven' })}
          </div>
          <div className={styles.filters}>
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
                onChange={(e) => setCovenInput(e.target.value)}
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

        <section className={styles.section} aria-label="Action">
          <h2 className={styles.sectionTitle}>Action</h2>
          <div className={styles.filters}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className={styles.metaKey}>Incarnation</div>
              <input
                list="known-incarnations"
                {...register('incarnation_name')}
                placeholder="redis-prod"
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  border: `1px solid ${errors.incarnation_name ? 'var(--danger)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  minWidth: 220,
                }}
              />
              <datalist id="known-incarnations">
                {(incarnations.data?.items ?? []).map((i) => <option key={i.name} value={i.name} />)}
              </datalist>
              {errors.incarnation_name ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.incarnation_name.message ?? '')}</span>
              ) : null}
            </label>
            <Input
              label="action_scenario (snake_case)"
              mono
              {...register('action_scenario')}
              placeholder="restart"
              error={errors.action_scenario?.message ? t(errors.action_scenario.message) : undefined}
            />
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={styles.metaKey}>{t('beacons:actionInputJsonLabel')}</span>
            <textarea
              {...register('action_input_json')}
              rows={5}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
                padding: 8,
                background: 'var(--surface)',
                border: `1px solid ${errors.action_input_json ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                resize: 'vertical',
              }}
              placeholder='{}'
            />
            {errors.action_input_json ? (
              <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.action_input_json.message ?? '')}</span>
            ) : null}
          </label>
        </section>

        {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="primary" disabled={isSubmitting || create.isPending}>
            {create.isPending ? t('creating') : t('createDecree')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => nav('/decrees')}>{t('cancel')}</Button>
        </div>
      </form>
    </div>
  );
}
