import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyLabelAfterCreate } from '../../api/applyLabel';
import { keeperApi, type DecreeCreateRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import { SubjectPicker } from './SubjectPicker';
import { useSubjectDraft } from './useSubjectDraft';
import { buildSubject, validateSubjectDraft } from './subject';
import { decreeFormSchema, type DecreeFormInput } from './schemas';
import styles from '../common.module.css';

export function DecreeNewForm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  // The entity exists once the create returned, even if its caption write was
  // refused. Re-submitting would 409 on the id — and for an incarnation it would
  // dispatch a second run — so the only way forward is to leave; the caption is
  // editable from the entity's own page.
  const [created, setCreated] = useState(false);
  // Required, one of four dimensions — see ./subject.ts. Distinct from
  // incarnation_name below: the subject says which hosts may FIRE the rule,
  // incarnation_name is the TARGET the reaction runs against.
  const subject = useSubjectDraft();
  const [subjectError, setSubjectError] = useState<string | null>(null);

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
    formState: { errors, isSubmitting },
  } = useForm<DecreeFormInput>({
    resolver: zodResolver(decreeFormSchema),
    defaultValues: {
      id: '',
      label: '',
      on_beacon: '',
      where: '',
      incarnation_name: '',
      action_scenario: '',
      action_input_json: '{}',
      cooldown: '',
      enabled: false, // default-deny, operator enables explicitly.
    },
  });

  const create = useMutation({
    // The caption travels on its own endpoint after the create: the keeper accepts
    // `label` in the create body and drops it (see applyLabelAfterCreate).
    mutationFn: async ({ body, label }: { body: DecreeCreateRequest; label: string }) => {
      const d = await keeperApi.decrees.create(body);
      const labelError = await applyLabelAfterCreate((b) => keeperApi.decrees.setLabel(d.id, b), label);
      return { d, labelError };
    },
    onSuccess: ({ d, labelError }) => {
      qc.invalidateQueries({ queryKey: ['decrees.list'] });
      if (labelError) {
        setCreated(true);
        setServerError(labelError);
        return;
      }
      nav(`/decrees/${encodeURIComponent(d.id)}`);
    },
    onError: (err) => {
      setServerError(
        err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err),
      );
    },
  });

  function onSubmit(values: DecreeFormInput) {
    setServerError(null);
    // Same reason as the Vigil form: a malformed subject comes back as 400
    // "unknown field in request body" / a bare "Malformed request", naming
    // nothing an operator can act on.
    const draft = subject.read();
    const badSubject = validateSubjectDraft(draft);
    setSubjectError(badSubject);
    if (badSubject) return;
    let actionInput: Record<string, unknown> = {};
    try {
      actionInput = JSON.parse(values.action_input_json || '{}') as Record<string, unknown>;
    } catch {
      actionInput = {};
    }
    const body: DecreeCreateRequest = {
      id: values.id,
      on_beacon: values.on_beacon,
      subject: buildSubject(draft),
      incarnation_name: values.incarnation_name,
      action_scenario: values.action_scenario,
      action_input: actionInput as DecreeCreateRequest['action_input'],
      enabled: values.enabled,
    };
    if (values.where) body.where = values.where;
    if (values.cooldown) body.cooldown = values.cooldown;
    create.mutate({ body, label: values.label });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.crumbs}>
            <a href="/decrees" onClick={(e) => { e.preventDefault(); nav('/decrees'); }}>decrees</a> / {t('crumbNew')}
          </div>
          <h1 className={styles.title}>{t('beacons:newDecreeTitle')}</h1>
          <div className={styles.crumbs}>{t('beacons:newDecreeSubtitle')}</div>
        </div>
      </div>

      {/* Also on the invalid path — see the same note in VigilNewForm. */}
      <form
        onSubmit={handleSubmit(onSubmit, () => setSubjectError(validateSubjectDraft(subject.read())))}
        noValidate
      >
        <section className={styles.section} aria-label={t('beacons:baseFieldsLegend')}>
          <h2 className={styles.sectionTitle}>{t('beacons:baseFieldsLegend')}</h2>
          <div className={styles.filters}>
            <Input
              label={t('common:colId')}
              mono
              {...register('id')}
              placeholder="restart-on-config-change"
              hint={t('beacons:idKebabHint')}
              error={errors.id?.message ? t(errors.id.message) : undefined}
            />
            <Input
              label={t('common:colLabel')}
              {...register('label')}
              placeholder="Restart on config change"
              hint={t('beacons:labelHint')}
              error={errors.label?.message ? t(errors.label.message) : undefined}
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
                {(vigils.data?.items ?? []).map((v) => <option key={v.id} value={v.id} />)}
              </datalist>
              {errors.on_beacon ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.on_beacon.message ?? '')}</span>
              ) : null}
            </label>
            <Input
              label={t('common:colCooldown')}
              mono
              {...register('cooldown')}
              placeholder={t('beacons:cooldownPlaceholder')}
              hint={t('beacons:durationHint')}
              error={errors.cooldown?.message ? t(errors.cooldown.message) : undefined}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className={styles.metaKey}>{t('beacons:enabledDefaultDeny')}</span>
              <input
                type="checkbox"
                {...register('enabled')}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
            </label>
          </div>
        </section>

        <section className={styles.section} aria-label={t('beacons:celWhereAria')}>
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

        <SubjectPicker
          value={subject.draft}
          onChange={(patch) => { subject.set(patch); setSubjectError(null); }}
          hintKey="beacons:subjectDecreeHint"
          error={subjectError ?? undefined}
        />

        <section className={styles.section} aria-label={t('common:colAction')}>
          <h2 className={styles.sectionTitle}>{t('colAction')}</h2>
          <div className={styles.filters}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className={styles.metaKey}>{t('common:colIncarnation')}</div>
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
                {(incarnations.data?.items ?? []).map((i) => <option key={i.id} value={i.id} />)}
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
          <Button type="submit" variant="primary" disabled={created || isSubmitting || create.isPending}>
            {create.isPending ? t('creating') : t('createDecree')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => nav('/decrees')}>{t('cancel')}</Button>
        </div>
      </form>
    </div>
  );
}
