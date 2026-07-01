import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box } from 'lucide-react';
import { Button, Input } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { ChipsInput } from './ChipsInput';
import { TraitsEditor, type TraitsMap } from './TraitsEditor';
import { useServiceScenarios } from './useServiceScenarios';
import { ScenarioInputFields } from './ScenarioInputFields';
import {
  computeVisibleFields,
  computeRequiredHostCount,
  defaultsFromSchema,
  isSupportedInputSchema,
  isProvisionObjectField,
  readProvisionEnabled,
  missingRequiredFields,
  serializeFields,
  type ScenarioFieldsState,
} from './scenarioInputFields.helpers';
import {
  incarnationCreateSchema,
  type IncarnationCreateFormInput,
  type IncarnationCreateFormOutput,
} from './schemas';
import styles from '../common.module.css';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function IncarnationNewForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdApplyId, setCreatedApplyId] = useState<string | null>(null);

  // Pre-fill из ?service=… (приходит из ServiceDetail → «Use in incarnation»).
  // ?scenario=… игнорируем: input создаваемой incarnation берётся строго из
  // ВЫБРАННОГО create-сценария (поле create=true в каталоге сценариев сервиса).
  const prefilledService = searchParams.get('service') ?? '';

  const services = useQuery({
    queryKey: ['services.list'],
    queryFn: () => keeperApi.services.list(),
  });

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<IncarnationCreateFormInput, unknown, IncarnationCreateFormOutput>({
    // zodResolver (@hookform/resolvers v3) не пробрасывает output-тип transform-схемы
    // в Resolver<Input, _, Output>; каст согласует типы без смены рантайма.
    resolver: zodResolver(incarnationCreateSchema) as Resolver<
      IncarnationCreateFormInput,
      unknown,
      IncarnationCreateFormOutput
    >,
    defaultValues: { name: '', service: prefilledService, covens: [], inputJson: '', traits: {} },
  });

  const selectedService = watch('service');
  const scenarios = useServiceScenarios(selectedService || undefined);

  // Сценарии с флагом create=true — предлагаются оператору при создании incarnation.
  // UI не хардкодит имя 'create': backend явно помечает нужные сценарии.
  const createScenarios = useMemo(
    () => scenarios.items.filter((s) => s.create),
    [scenarios.items],
  );

  // Выбранный create-сценарий (dropdown). Пред-выбираем первый для удобства.
  // undefined — ни один не выбран (недопустимо, если createScenarios.length >= 1).
  const [selectedCreateScenario, setSelectedCreateScenario] = useState<
    (typeof createScenarios)[number] | undefined
  >(undefined);

  // Сбрасываем выбор при смене сервиса / обновлении каталога сценариев.
  useEffect(() => {
    setSelectedCreateScenario(createScenarios.length > 0 ? createScenarios[0] : undefined);
  }, [createScenarios]);

  const createSchema = selectedCreateScenario?.input_schema;
  const usePerField = isSupportedInputSchema(createSchema);

  const [fields, setFields] = useState<ScenarioFieldsState>({});
  const [showInputErrors, setShowInputErrors] = useState(false);
  useEffect(() => {
    if (usePerField && createSchema) {
      setFields(defaultsFromSchema(createSchema));
    } else {
      setFields({});
    }
    setShowInputErrors(false);
  }, [usePerField, selectedService, createSchema]);

  // Пустые required-поля create-input (зеркалит backend 422). Submit блокируется
  // до заполнения; inline-ошибка под полем — после попытки submit.
  // visibleFields учитывает show_when секций/полей — скрытые поля не блокируют.
  // required_when учитывается через isFieldRequired внутри missingRequiredFields.
  const missingRequired = useMemo(
    () => {
      if (!usePerField || !createSchema) return [];
      const visibleFields = computeVisibleFields(selectedCreateScenario?.form, fields);
      return missingRequiredFields(createSchema, fields, visibleFields);
    },
    [usePerField, createSchema, selectedCreateScenario?.form, fields],
  );

  // Блокируем submit, если сервис имеет create-сценарии, но ни один не выбран.
  const missingScenarioSelection = createScenarios.length > 0 && !selectedCreateScenario;

  // Pre-submit предупреждение: provision выключен, но сценарий требует хосты.
  // Вычисляем: есть ли provision-поле в схеме, включён ли provision, сколько нужно хостов.
  const provisionWarning = useMemo(() => {
    if (!createSchema || !usePerField) return null;
    // Ищем поле provision в схеме (объект с properties.enabled:boolean).
    const provisionEntry = Object.entries(createSchema).find(
      ([, prop]) => isProvisionObjectField(prop),
    );
    if (!provisionEntry) return null;
    const [provisionKey] = provisionEntry;
    const provisionRaw = fields[provisionKey];
    // Если provision включён — предупреждение не нужно.
    if (readProvisionEnabled(provisionRaw)) return null;
    // Нужно ли N хостов? Считаем из replicas_per_master/shards.
    const requiredHosts = computeRequiredHostCount(fields);
    if (requiredHosts === null) return null;
    return requiredHosts;
  }, [createSchema, usePerField, fields]);

  const createMu = useMutation({
    mutationFn: (body: { name: string; service: string; covens: string[]; input: Record<string, unknown>; create_scenario?: string; traits?: TraitsMap }) =>
      keeperApi.incarnations.create(body),
    onSuccess: (reply) => {
      setCreatedApplyId(reply.apply_id ?? null);
      setTimeout(() => navigate(`/incarnations/${encodeURIComponent(reply.incarnation)}`), 600);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        setServerError(t('incarnations:missingRequired', { fields: missingRequired.join(', ') || err.detail }));
        setShowInputErrors(true);
        return;
      }
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function onSubmit(values: IncarnationCreateFormOutput) {
    setServerError(null);
    setCreatedApplyId(null);
    // Валидация выбора сценария — если есть create-сценарии, выбор обязателен.
    if (missingScenarioSelection) {
      setServerError(t('incarnations:createScenarioRequired'));
      return;
    }
    // Required-валидация ДО запроса (не доводим до backend 422).
    if (missingRequired.length > 0) {
      setShowInputErrors(true);
      setServerError(t('incarnations:missingRequired', { fields: missingRequired.join(', ') }));
      return;
    }
    const input =
      usePerField && createSchema ? serializeFields(createSchema, fields) : {};
    const traits = Object.keys(values.traits).length > 0 ? values.traits : undefined;
    createMu.mutate({
      name: values.name,
      service: values.service,
      covens: values.covens,
      input,
      // Для bare-инкарнации (нет create-сценариев) — не передаём create_scenario.
      ...(selectedCreateScenario ? { create_scenario: selectedCreateScenario.name } : {}),
      traits,
    });
  }

  const serviceItems = services.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/incarnations">incarnations</Link> / <span>new</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Box size={22} /> {t('incarnations:title')}
            </h1>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
        <Input
          label="Name (kebab-case)"
          placeholder="redis-prod"
          mono
          aria-invalid={errors.name ? 'true' : undefined}
          error={errors.name ? t(errors.name.message ?? '') : undefined}
          {...register('name')}
        />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Service</span>
          <select
            {...register('service')}
            disabled={services.isLoading}
            aria-invalid={errors.service ? 'true' : undefined}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${errors.service ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
            }}
          >
            <option value="">{t('incarnations:selectService')}</option>
            {serviceItems.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.ref})
              </option>
            ))}
          </select>
          {errors.service ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.service.message ?? '')}</span>
          ) : services.error ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>
              {t('incarnations:servicesLoadFailed')}
            </span>
          ) : (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {t('incarnations:servicesSource')}
            </span>
          )}
        </label>

        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            {t('incarnations:covensLabel')}
          </div>
          <Controller
            control={control}
            name="covens"
            render={({ field }) => (
              <ChipsInput
                value={field.value ?? []}
                onChange={field.onChange}
                placeholder={t('incarnations:covensPlaceholder')}
                ariaLabel="Covens"
                validate={(tok) => (KEBAB.test(tok) ? null : t('incarnations:kebabPattern'))}
              />
            )}
          />
        </div>

        <div data-testid="traits-section">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
            {t('incarnations:traitsLabel')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>
            {t('incarnations:traitsHint')}
          </div>
          <Controller
            control={control}
            name="traits"
            render={({ field }) => (
              <TraitsEditor
                value={field.value as TraitsMap}
                onChange={field.onChange}
              />
            )}
          />
        </div>

        {/* Dropdown выбора create-сценария — только если сервис имеет create-сценарии */}
        {selectedService && !scenarios.loading && !scenarios.unavailable && createScenarios.length > 0 ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="create-scenario-select-wrapper">
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('incarnations:createScenarioLabel')}
            </span>
            <select
              data-testid="create-scenario-select"
              value={selectedCreateScenario?.name ?? ''}
              onChange={(e) => {
                const found = createScenarios.find((s) => s.name === e.target.value);
                setSelectedCreateScenario(found);
              }}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: `1px solid ${missingScenarioSelection ? 'var(--danger)' : 'var(--border)'}`,
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}
            >
              {createScenarios.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}{s.description ? ` — ${s.description}` : ''}
                </option>
              ))}
            </select>
            {missingScenarioSelection ? (
              <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                {t('incarnations:createScenarioRequired')}
              </span>
            ) : null}
          </label>
        ) : null}

        {/* Хелп-блок create_from_souls: напоминает про onboarding souls до запуска */}
        {selectedCreateScenario?.name?.includes('from_souls') ? (
          <div
            style={{
              padding: '10px 12px',
              background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
            data-testid="create-from-souls-hint"
          >
            <span>
              {t('incarnations:createFromSoulsHint', { coven: watch('name') || '…' })}
            </span>
            <Link
              to="/souls"
              style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
            >
              {t('incarnations:createFromSoulsHostsLink')}
            </Link>
          </div>
        ) : null}

        {/* Bare-инкарнация: сервис без create-сценариев */}
        {selectedService && !scenarios.loading && !scenarios.unavailable && createScenarios.length === 0 ? (
          <div
            style={{
              padding: '10px 12px',
              background: 'color-mix(in srgb, var(--text-faint) 6%, var(--surface))',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              color: 'var(--text-faint)',
            }}
            data-testid="create-bare-info"
          >
            {t('incarnations:createBareInfo')}
          </div>
        ) : null}

        {selectedService && usePerField && createSchema ? (
          <div data-testid="create-input-fields">
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              {t('incarnations:createInputFields')}
            </div>
            <ScenarioInputFields
              schema={createSchema}
              value={fields}
              onChange={setFields}
              showErrors={showInputErrors}
              form={selectedCreateScenario?.form}
              incarnationName={watch('name') || undefined}
            />
            {selectedCreateScenario?.description ? (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-faint)' }}>
                {selectedCreateScenario.description}
              </div>
            ) : null}
          </div>
        ) : selectedService && !scenarios.loading && !scenarios.unavailable && createScenarios.length > 0 && selectedCreateScenario ? (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid="create-input-empty">
            {t('incarnations:createNoInput')}
          </div>
        ) : null}

        {/* Pre-submit предупреждение: provision выключен, но топология требует хостов */}
        {provisionWarning !== null ? (
          <div
            data-testid="provision-host-warning"
            style={{
              padding: '10px 14px',
              background: 'color-mix(in srgb, var(--warning, #f59e0b) 8%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 35%, var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              color: 'var(--text)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {t('incarnations:provisionHostWarningTitle')}
            </span>
            <span>
              {t('incarnations:provisionHostWarningBody', {
                n: provisionWarning,
                coven: watch('name') || '…',
              })}
            </span>
          </div>
        ) : null}

        {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}
        {createdApplyId ? (
          <div
            style={{
              padding: 12,
              background: 'color-mix(in srgb, var(--ok) 8%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--ok) 30%, var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: 13,
            }}
          >
            {t('incarnations:created')} <span className="mono">{createdApplyId}</span>{t('incarnations:createdGoTo')}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting || createMu.isPending || missingRequired.length > 0 || missingScenarioSelection}
          >
            {createMu.isPending ? t('creating') : t('createIncarnation')}
          </Button>
          <Link to="/incarnations">
            <Button type="button" variant="ghost">{t('cancel')}</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
