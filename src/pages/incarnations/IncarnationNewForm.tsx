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
import { useServiceDirectives } from './useServiceDirectives';
import { ScenarioInputFields } from './ScenarioInputFields';
import { ComposedNamePreview } from './ComposedNamePreview';
import {
  computeVisibleFields,
  computeRequiredHostCount,
  defaultsFromSchema,
  isSupportedInputSchema,
  isProvisionObjectField,
  readProvisionEnabled,
  missingRequiredFields,
  schemaHasDirectiveField,
  serializeFields,
  type DirectiveCatalogContext,
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

  // Pre-fill from ?service=... (comes from ServiceDetail -> "Use in incarnation").
  // ?scenario=... is ignored: the input of the incarnation being created comes strictly from
  // the SELECTED create scenario (the create=true field in the service's scenario catalog).
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
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IncarnationCreateFormInput, unknown, IncarnationCreateFormOutput>({
    // zodResolver (@hookform/resolvers v3) doesn't propagate the transform schema's output type
    // into Resolver<Input, _, Output>; the cast reconciles the types without changing runtime behavior.
    resolver: zodResolver(incarnationCreateSchema) as Resolver<
      IncarnationCreateFormInput,
      unknown,
      IncarnationCreateFormOutput
    >,
    defaultValues: { name: '', service: prefilledService, covens: [], inputJson: '', traits: {} },
  });

  const selectedService = watch('service');
  const scenarios = useServiceScenarios(selectedService || undefined);

  // Scenarios with the create=true flag are offered to the operator when creating an incarnation.
  // UI doesn't hardcode the name 'create': the backend explicitly flags the relevant scenarios.
  const createScenarios = useMemo(
    () => scenarios.items.filter((s) => s.create),
    [scenarios.items],
  );

  // Selected create scenario (dropdown). Pre-select the first one for convenience.
  // undefined — none selected (invalid if createScenarios.length >= 1).
  const [selectedCreateScenario, setSelectedCreateScenario] = useState<
    (typeof createScenarios)[number] | undefined
  >(undefined);

  // Reset the selection when the service changes / the scenario catalog updates.
  useEffect(() => {
    setSelectedCreateScenario(createScenarios.length > 0 ? createScenarios[0] : undefined);
  }, [createScenarios]);

  const createSchema = selectedCreateScenario?.input_schema;
  const usePerField = isSupportedInputSchema(createSchema);

  // The chosen create scenario composes the name from its input components
  // (ADR-0079), so the operator does not type one and the keeper REFUSES a request
  // that carries one. The name field gives way to a live preview of what the create
  // would compose. An older keeper omits the flag → false → the form behaves as
  // before, with a typed name.
  const composesName = selectedCreateScenario?.composes_name === true;

  const [fields, setFields] = useState<ScenarioFieldsState>({});
  const [showInputErrors, setShowInputErrors] = useState(false);
  useEffect(() => {
    if (usePerField && createSchema) {
      setFields(defaultsFromSchema(createSchema));
    } else {
      setFields({});
    }
    setShowInputErrors(false);
    setInvalidMaps([]);
  }, [usePerField, selectedService, createSchema]);

  // Empty required create-input fields (mirrors backend 422). Submit is blocked
  // until filled; inline error under the field appears after a submit attempt.
  // visibleFields accounts for show_when of sections/fields — hidden fields don't block.
  // required_when is handled via isFieldRequired inside missingRequiredFields.
  const missingRequired = useMemo(
    () => {
      if (!usePerField || !createSchema) return [];
      const visibleFields = computeVisibleFields(selectedCreateScenario?.form, fields);
      return missingRequiredFields(createSchema, fields, visibleFields);
    },
    [usePerField, createSchema, selectedCreateScenario?.form, fields],
  );

  // Block submit if the service has create scenarios but none is selected.
  const missingScenarioSelection = createScenarios.length > 0 && !selectedCreateScenario;

  // NIM-76: set of map fields with errors (duplicate/incomplete/bad-int/unknown-directive)
  // — included in the submit gate (hard block alongside missingRequired).
  const [invalidMaps, setInvalidMaps] = useState<string[]>([]);

  // NIM-76: Redis directive catalog — only if the schema has a field with x-directives
  // (we don't fetch the catalog for non-redis services). Version is reactive from fields.
  const hasDirectiveField = useMemo(() => schemaHasDirectiveField(createSchema), [createSchema]);
  const directivesQ = useServiceDirectives(hasDirectiveField ? selectedService || undefined : undefined);
  const directiveCatalog = useMemo<DirectiveCatalogContext>(
    () => ({ directives: directivesQ.directives, loaded: !directivesQ.loading && !directivesQ.unavailable }),
    [directivesQ.directives, directivesQ.loading, directivesQ.unavailable],
  );
  // Redis version from create-input — drives the directive set. Contract: the version field
  // of the create schema = top-level `redis_version` (priority) or `version`. Reactive from fields.
  const directiveVersion = useMemo(() => {
    const raw = fields['redis_version'] ?? fields['version'];
    return raw === undefined || raw === '' ? undefined : String(raw);
  }, [fields]);

  // Pre-submit warning: provision is disabled but the scenario requires hosts.
  // Computed: whether a provision field exists in the schema, whether provision is enabled, how many hosts are needed.
  const provisionWarning = useMemo(() => {
    if (!createSchema || !usePerField) return null;
    // Look for a provision field in the schema (an object with properties.enabled:boolean).
    const provisionEntry = Object.entries(createSchema).find(
      ([, prop]) => isProvisionObjectField(prop),
    );
    if (!provisionEntry) return null;
    const [provisionKey] = provisionEntry;
    const provisionRaw = fields[provisionKey];
    // If provision is enabled, no warning is needed.
    if (readProvisionEnabled(provisionRaw)) return null;
    // Are N hosts needed? Computed from replicas_per_master/shards.
    const requiredHosts = computeRequiredHostCount(fields);
    if (requiredHosts === null) return null;
    return requiredHosts;
  }, [createSchema, usePerField, fields]);

  // The SAME serialization the create posts. Previewing over the raw field state
  // would measure a different input than the one the name gets composed from — the
  // divergence this feature exists to prevent, reintroduced on the client side.
  const previewInput = useMemo(
    () => (usePerField && createSchema ? serializeFields(createSchema, fields) : {}),
    [usePerField, createSchema, fields],
  );

  const createMu = useMutation({
    mutationFn: (body: { name?: string; service: string; covens: string[]; input: Record<string, unknown>; create_scenario?: string; traits?: TraitsMap }) =>
      keeperApi.incarnations.create(body),
    onSuccess: (reply) => {
      setCreatedApplyId(reply.apply_id ?? null);
      setTimeout(() => navigate(`/incarnations/${encodeURIComponent(reply.incarnation)}`), 600);
    },
    onError: (err) => {
      // "field 'name' is required" belongs on the name input — a failure of one field reads
      // wrong in the generic banner. But when the scenario composes the name there IS no
      // input: the two sides disagree (the descriptor said composing, the keeper then asked
      // for a name), and attaching the error to a field that is not rendered would drop the
      // message entirely. Then, and only then, it goes to the form-level box.
      if (err instanceof ApiError && err.status === 422 && /field 'name' is required/i.test(err.detail ?? '')) {
        if (composesName) {
          setServerError(t('incarnations:nameRequiredByScenario'));
        } else {
          setError('name', { type: 'server', message: 'incarnations:nameRequiredByScenario' });
        }
        return;
      }
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
    // Conditional, which the zod schema cannot be: whether a name is required is a
    // property of the CHOSEN scenario, not of the field. NIM-340 had to drop the
    // requirement outright because the scenario list carried no such flag, which
    // lost the check wherever a name IS still typed; `composes_name` restores it
    // without re-breaking the templated path.
    if (!composesName && !values.name) {
      setError('name', { type: 'required', message: 'incarnations:nameRequired' });
      return;
    }
    // Scenario selection validation — if create scenarios exist, selection is required.
    if (missingScenarioSelection) {
      setServerError(t('incarnations:createScenarioRequired'));
      return;
    }
    // Required validation BEFORE the request (avoid hitting backend 422).
    if (missingRequired.length > 0) {
      setShowInputErrors(true);
      setServerError(t('incarnations:missingRequired', { fields: missingRequired.join(', ') }));
      return;
    }
    // NIM-76: hard block on invalid map fields (incl. unknown-directive).
    if (invalidMaps.length > 0) {
      setShowInputErrors(true);
      return;
    }
    const input =
      usePerField && createSchema ? serializeFields(createSchema, fields) : {};
    const traits = Object.keys(values.traits).length > 0 ? values.traits : undefined;
    createMu.mutate({
      // Decided by the flag, not by emptiness. Hiding the input does not clear it, so a name
      // typed for a previously selected scenario is still in form state when the operator
      // switches to one that composes — and a composing scenario rejects a request carrying
      // `name` at all. Testing `values.name` here would send that leftover and earn the very
      // 422 this path exists to avoid.
      ...(composesName || !values.name ? {} : { name: values.name }),
      service: values.service,
      covens: values.covens,
      input,
      // For a bare incarnation (no create scenarios) — don't pass create_scenario.
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
        {composesName ? (
          <ComposedNamePreview
            service={selectedService}
            scenario={selectedCreateScenario!.name}
            input={previewInput}
            covens={watch('covens') ?? []}
          />
        ) : (
          // No "leave it empty if the scenario composes the name" note here. This branch IS
          // the one where nothing composes it and the name is required, so that instruction
          // told the operator to do the one thing the form then rejects — it sat directly
          // above "required field". It was written when the form could not tell the two kinds
          // of scenario apart and had to ask the operator to guess; `composes_name` decides
          // now, and the composing branch above explains itself.
          <Input
            label={t('incarnations:newNameLabel')}
            placeholder="redis-prod"
            mono
            data-testid="incarnation-name-input"
            aria-invalid={errors.name ? 'true' : undefined}
            error={errors.name ? t(errors.name.message ?? '') : undefined}
            {...register('name')}
          />
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Service</span>
          <select
            {...register('service')}
            disabled={services.isLoading}
            data-testid="incarnation-service-select"
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

        {/* Create-scenario select dropdown — only if the service has create scenarios */}
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

        {/* create_from_souls help block: reminds about onboarding souls before running */}
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

        {/* Bare incarnation: service with no create scenarios */}
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
              onInvalidMapChange={setInvalidMaps}
              directiveCatalog={directiveCatalog}
              directiveVersion={directiveVersion}
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

        {/* Pre-submit warning: provision is disabled but the topology requires hosts */}
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

        {serverError ? <div className={styles.errorBox} data-testid="incarnation-create-error">{serverError}</div> : null}
        {createdApplyId ? (
          <div
            data-testid="incarnation-created"
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
            disabled={isSubmitting || createMu.isPending || missingRequired.length > 0 || missingScenarioSelection || invalidMaps.length > 0}
            data-testid="incarnation-submit"
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
