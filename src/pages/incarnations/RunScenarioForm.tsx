import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { Button, Input } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import {
  runScenarioSchema,
  type RunScenarioFormInput,
  type RunScenarioFormOutput,
} from './schemas';
import styles from '../common.module.css';

interface Props {
  incarnationName: string;
}

export function RunScenarioForm({ incarnationName }: Props) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [reply, setReply] = useState<{ apply_id: string; scenario: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RunScenarioFormInput, unknown, RunScenarioFormOutput>({
    resolver: zodResolver(runScenarioSchema),
    defaultValues: { scenario: '', inputJson: '' },
  });

  const mu = useMutation({
    mutationFn: (values: RunScenarioFormOutput) =>
      keeperApi.incarnations.runScenario(incarnationName, values.scenario, {
        input: values.inputJson,
      }),
    onSuccess: (r) => {
      setReply({ apply_id: r.apply_id, scenario: r.scenario });
      // history & status могли поменяться.
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnation-history', incarnationName] });
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
    },
  });

  function onSubmit(values: RunScenarioFormOutput) {
    setServerError(null);
    setReply(null);
    mu.mutate(values);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}
    >
      <Input
        label="Scenario name"
        placeholder="restart / add_user / converge / …"
        mono
        aria-invalid={errors.scenario ? 'true' : undefined}
        error={errors.scenario?.message}
        hint="Должен совпадать с именем scenario/<name>/ в сервисе."
        {...register('scenario')}
      />

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Input (JSON-объект)</span>
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
          <span style={{ color: 'var(--danger)', fontSize: 12 }}>{errors.inputJson.message}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            Соответствует <code className="mono">input_schema</code> сценария.
          </span>
        )}
      </label>

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
          Запуск принят: scenario <span className="mono">{reply.scenario}</span>, apply_id{' '}
          <span className="mono">{reply.apply_id}</span>. История пополнится после завершения прогона.
        </div>
      ) : null}
      {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}

      <div style={{ display: 'flex', gap: 10 }}>
        <Button type="submit" variant="primary" disabled={isSubmitting || mu.isPending}>
          <Play size={14} /> {mu.isPending ? 'Запускаем…' : 'Run scenario'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset();
            setReply(null);
            setServerError(null);
          }}
        >
          Сбросить
        </Button>
      </div>
    </form>
  );
}
