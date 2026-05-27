import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box } from 'lucide-react';
import { Button, Input } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { ChipsInput } from './ChipsInput';
import { useServiceScenarios } from './useServiceScenarios';
import { ScenarioInputFields } from './ScenarioInputFields';
import {
  defaultsFromSchema,
  isSupportedInputSchema,
  serializeFields,
  type ScenarioFieldsState,
} from './scenarioInputFields.helpers';
import { DynamicInputBuilder } from '../../components/input/DynamicInputBuilder';
import {
  incarnationCreateSchema,
  type IncarnationCreateFormInput,
  type IncarnationCreateFormOutput,
} from './schemas';
import styles from '../common.module.css';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function IncarnationNewForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdApplyId, setCreatedApplyId] = useState<string | null>(null);

  // Pre-fill из ?service=…&scenario=… (приходит из ServiceDetail → «Use in incarnation»).
  const prefilledService = searchParams.get('service') ?? '';
  const prefilledScenario = searchParams.get('scenario') ?? '';

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
    resolver: zodResolver(incarnationCreateSchema),
    defaultValues: { name: '', service: prefilledService, covens: [], inputJson: '' },
  });

  const selectedService = watch('service');
  const scenarios = useServiceScenarios(selectedService || undefined);

  // Локальное состояние «выбранный scenario» — не часть POST /v1/incarnations
  // (там сценарий всегда `create`); используется только как контекст для input-формы.
  const [selectedScenarioName, setSelectedScenarioName] = useState<string>(prefilledScenario);
  useEffect(() => {
    // При смене service сбрасываем выбор scenario, если он не валиден в новом каталоге.
    if (
      selectedScenarioName &&
      !scenarios.loading &&
      !scenarios.unavailable &&
      !scenarios.items.some((s) => s.name === selectedScenarioName)
    ) {
      setSelectedScenarioName('');
    }
  }, [scenarios.loading, scenarios.unavailable, scenarios.items, selectedScenarioName]);

  const selectedScenario = useMemo(
    () => scenarios.items.find((s) => s.name === selectedScenarioName),
    [scenarios.items, selectedScenarioName],
  );
  const supportedSchema = selectedScenario?.input_schema;
  const usePerField = isSupportedInputSchema(supportedSchema);

  const [fields, setFields] = useState<ScenarioFieldsState>({});
  useEffect(() => {
    if (usePerField && supportedSchema) {
      setFields(defaultsFromSchema(supportedSchema));
    } else {
      setFields({});
    }
  }, [usePerField, selectedScenarioName, supportedSchema]);

  // Состояние DynamicInputBuilder — используется когда scenario без typed schema.
  // Сбрасывается при смене scenario (как и `fields`).
  const [dynamicInput, setDynamicInput] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setDynamicInput({});
  }, [selectedScenarioName]);

  const createMu = useMutation({
    mutationFn: (body: { name: string; service: string; covens: string[]; input: Record<string, unknown> }) =>
      keeperApi.incarnations.create(body),
    onSuccess: (reply) => {
      setCreatedApplyId(reply.apply_id);
      setTimeout(() => navigate(`/incarnations/${encodeURIComponent(reply.incarnation)}`), 600);
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
    },
  });

  function onSubmit(values: IncarnationCreateFormOutput) {
    setServerError(null);
    setCreatedApplyId(null);
    const input =
      usePerField && supportedSchema
        ? serializeFields(supportedSchema, fields)
        : dynamicInput;
    createMu.mutate({
      name: values.name,
      service: values.service,
      covens: values.covens,
      input,
    });
  }

  const serviceItems = services.data?.items ?? [];
  const scenarioSelectAvailable = !scenarios.unavailable && scenarios.items.length > 0;

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/incarnations">incarnations</Link> / <span>new</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Box size={22} /> Новая incarnation
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
          error={errors.name?.message}
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
            <option value="">— выберите сервис —</option>
            {serviceItems.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.ref})
              </option>
            ))}
          </select>
          {errors.service ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{errors.service.message}</span>
          ) : services.error ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>
              Не удалось загрузить services. POST /v1/incarnations будет проверять имя на серверной стороне.
            </span>
          ) : (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              Список из <code className="mono">GET /v1/services</code>.
            </span>
          )}
        </label>

        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            Covens (declared environment-теги)
          </div>
          <Controller
            control={control}
            name="covens"
            render={({ field }) => (
              <ChipsInput
                value={field.value}
                onChange={field.onChange}
                placeholder="prod, datacenter-1 (Enter / пробел / запятая для добавления)"
                ariaLabel="Covens"
                validate={(t) => (KEBAB.test(t) ? null : 'kebab-case: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$')}
              />
            )}
          />
        </div>

        {selectedService && scenarioSelectAvailable ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Scenario (контекст input-формы)
            </span>
            <select
              value={selectedScenarioName}
              onChange={(e) => setSelectedScenarioName(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}
            >
              <option value="">— JSON-режим (без схемы) —</option>
              {scenarios.items.map((s) => (
                <option key={s.name} value={s.name} title={s.description ?? ''}>
                  {s.name}
                  {s.description ? ` — ${s.description}` : ''}
                </option>
              ))}
            </select>
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              POST /v1/incarnations всегда вызывает scenario <code className="mono">create</code>;
              выбор здесь задаёт input_schema для генерации полей.
            </span>
          </label>
        ) : null}

        {usePerField && supportedSchema ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              Input (поля scenario <code className="mono">{selectedScenarioName}</code>)
            </div>
            <ScenarioInputFields
              schema={supportedSchema}
              value={fields}
              onChange={setFields}
            />
            {selectedScenario?.description ? (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-faint)' }}>
                {selectedScenario.description}
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              Input scenario create (динамический form-builder)
            </div>
            <DynamicInputBuilder
              value={dynamicInput}
              onChange={setDynamicInput}
              ariaLabel="Scenario create input fields"
            />
            <span style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 6, display: 'block' }}>
              Передаётся как <code className="mono">input</code> в <code className="mono">scenario create</code>.
              Пусто = <code className="mono">{'{}'}</code>.
            </span>
          </div>
        )}

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
            Создано. apply_id: <span className="mono">{createdApplyId}</span>. Переходим к incarnation…
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="submit" variant="primary" disabled={isSubmitting || createMu.isPending}>
            {createMu.isPending ? 'Создаём…' : 'Создать incarnation'}
          </Button>
          <Link to="/incarnations">
            <Button type="button" variant="ghost">Отмена</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
