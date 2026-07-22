import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { Button } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import {
  runScenarioSchema,
  type RunScenarioFormInput,
  type RunScenarioFormOutput,
} from './schemas';
import { ScenarioField } from './ScenarioPicker';
import { useServiceScenarios } from './useServiceScenarios';
import { ScenarioInputFields } from './ScenarioInputFields';
import {
  defaultsFromSchema,
  isSupportedInputSchema,
  serializeFields,
  type ScenarioFieldsState,
} from './scenarioInputFields.helpers';
import styles from '../common.module.css';

interface Props {
  incarnationName: string;
  serviceName?: string;
}

export function RunScenarioForm({ incarnationName, serviceName }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [reply, setReply] = useState<{ apply_id: string; scenario: string } | null>(null);

  const scenarios = useServiceScenarios(serviceName);

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RunScenarioFormInput, unknown, RunScenarioFormOutput>({
    // zodResolver (@hookform/resolvers v3) doesn't propagate the output type of a transform
    // schema into Resolver<Input, _, Output>; the cast aligns types without changing runtime behavior.
    resolver: zodResolver(runScenarioSchema) as Resolver<
      RunScenarioFormInput,
      unknown,
      RunScenarioFormOutput
    >,
    defaultValues: { scenario: '', inputJson: '' },
  });

  const selectedScenarioName = watch('scenario');
  const selectedScenario = useMemo(
    () => scenarios.items.find((s) => s.name === selectedScenarioName),
    [scenarios.items, selectedScenarioName],
  );
  const supportedSchema = selectedScenario?.input_schema;
  const usePerField = isSupportedInputSchema(supportedSchema);

  // Per-field state lives separately from RHF (dynamic schema).
  const [fields, setFields] = useState<ScenarioFieldsState>({});
  useEffect(() => {
    if (usePerField && supportedSchema) {
      setFields(defaultsFromSchema(supportedSchema));
    } else {
      setFields({});
    }
  }, [usePerField, selectedScenarioName, supportedSchema]);

  const mu = useMutation({
    mutationFn: (args: { scenario: string; input: Record<string, unknown> }) =>
      keeperApi.incarnations.runScenario(incarnationName, args.scenario, {
        input: args.input,
      }),
    onSuccess: (r) => {
      setReply({ apply_id: r.apply_id, scenario: r.scenario });
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnation-history', incarnationName] });
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function onSubmit(values: RunScenarioFormOutput) {
    setServerError(null);
    setReply(null);
    const input =
      usePerField && supportedSchema
        ? serializeFields(supportedSchema, fields)
        : values.inputJson;
    mu.mutate({ scenario: values.scenario, input });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}
    >
      <Controller
        control={control}
        name="scenario"
        render={({ field }) => (
          <ScenarioField
            scenarios={scenarios}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={errors.scenario ? t(errors.scenario.message ?? '') : undefined}
          />
        )}
      />

      {usePerField && supportedSchema ? (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            {t('incarnations:inputScenarioFieldsGeneric')}
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('incarnations:inputJsonLabel')}</span>
          <textarea
            placeholder='{}'
            rows={8}
            spellCheck={false}
            aria-invalid={errors.inputJson ? 'true' : undefined}
            {...register('inputJson')}
            style={{
              padding: 10,
              borderRadius: 'var(--radius)',
              border: `1px solid ${errors.inputJson ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              resize: 'vertical',
              minHeight: 120,
            }}
          />
          {errors.inputJson ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.inputJson.message ?? '')}</span>
          ) : (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {selectedScenario && !usePerField
                ? t('incarnations:inputComplexJson')
                : t('incarnations:inputMatchesSchema')}
            </span>
          )}
        </label>
      )}

      {reply ? (
        <div
          style={{
            padding: 12,
            background: 'color-mix(in srgb, var(--ok) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--ok) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}
        >
          {t('incarnations:runAccepted')} <span className="mono">{reply.scenario}</span>, apply_id{' '}
          <span className="mono">{reply.apply_id}</span>{t('incarnations:runAcceptedTail')}
        </div>
      ) : null}
      {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}

      <div style={{ display: 'flex', gap: 10 }}>
        <Button type="submit" variant="primary" disabled={isSubmitting || mu.isPending}>
          <Play size={14} /> {mu.isPending ? t('running') : t('runScenario')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset();
            setReply(null);
            setServerError(null);
            setFields({});
          }}
        >
          {t('reset')}
        </Button>
      </div>
    </form>
  );
}
