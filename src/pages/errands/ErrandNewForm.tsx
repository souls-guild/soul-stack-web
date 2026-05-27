import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useForm,
  useFieldArray,
  type Resolver,
  type UseFormRegister,
  type FieldValues,
  type Path,
  type ArrayPath,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send, Plus, Trash2, Terminal } from 'lucide-react';
import { keeperApi, type ErrandRunRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import {
  KNOWN_MODULES,
  isKnownModule,
  shellSchema,
  execSchema,
  jsonFallbackSchema,
  shellToInput,
  execToInput,
  jsonFallbackToInput,
  type ShellInput,
  type ExecInput,
  type JsonFallbackInput,
} from './schemas';
import styles from '../common.module.css';

// Submit-flow:
//   1. Валидируем форму через zod resolver конкретного модуля.
//   2. Маппим в ErrandRunRequest (module/input/timeout_seconds/dry_run).
//   3. POST /v1/souls/{sid}/exec → sync (ErrandResult) или async (ErrandAccepted).
//   4. В обоих случаях навигируем на /errands/<errand_id> (detail с polling).

type ModuleKind = 'core.cmd.shell' | 'core.exec.run' | 'custom';

function pickKindFromQuery(m: string | null): ModuleKind {
  if (m && isKnownModule(m)) return m;
  if (m) return 'custom';
  return 'core.cmd.shell';
}

const selectStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
};

const textareaStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12.5,
  padding: 8,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  resize: 'vertical',
};

export function ErrandNewForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const prefilledSid = params.get('sid') ?? '';
  const prefilledModule = params.get('module');

  const [kind, setKind] = useState<ModuleKind>(() => pickKindFromQuery(prefilledModule));

  // souls list — для dropdown подсказок. Подгружаем только когда sid не задан через query.
  const souls = useQuery({
    queryKey: ['errand.new.souls'],
    queryFn: () => keeperApi.souls.list({ limit: 200 }),
    enabled: !prefilledSid,
  });
  const soulsOptions = !prefilledSid ? (souls.data?.items ?? []).map((s) => s.sid) : [];

  const exec = useMutation({
    mutationFn: (req: { sid: string; body: ErrandRunRequest }) =>
      keeperApi.souls.exec(req.sid, req.body),
    onSuccess: (resp) => {
      const id = resp.kind === 'sync' ? resp.result.errand_id : resp.accepted.errand_id;
      navigate(`/errands/${encodeURIComponent(id)}`);
    },
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Terminal size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Run Errand
          </h1>
          <div className={styles.crumbs}>pull ad-hoc запуск одного модуля на Soul (ADR-033)</div>
        </div>
      </div>

      <section className={styles.section} aria-label="Module">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 320 }}>
          <span className={styles.metaKey}>Module</span>
          <select
            value={kind === 'custom' ? '__custom__' : kind}
            aria-label="Module kind"
            onChange={(e) => {
              const v = e.target.value;
              setKind(v === '__custom__' ? 'custom' : (v as ModuleKind));
            }}
            style={selectStyle}
          >
            {KNOWN_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom__">— custom (JSON) —</option>
          </select>
        </label>
      </section>

      {kind === 'core.cmd.shell' ? (
        <ShellForm
          prefilledSid={prefilledSid}
          soulsOptions={soulsOptions}
          pending={exec.isPending}
          error={exec.error}
          onSubmit={(v) =>
            exec.mutate({
              sid: v.sid,
              body: {
                module: 'core.cmd.shell',
                input: shellToInput(v),
                timeout_seconds: v.timeout_seconds,
                dry_run: v.dry_run,
              },
            })
          }
        />
      ) : null}

      {kind === 'core.exec.run' ? (
        <ExecForm
          prefilledSid={prefilledSid}
          soulsOptions={soulsOptions}
          pending={exec.isPending}
          error={exec.error}
          onSubmit={(v) =>
            exec.mutate({
              sid: v.sid,
              body: {
                module: 'core.exec.run',
                input: execToInput(v),
                timeout_seconds: v.timeout_seconds,
                dry_run: v.dry_run,
              },
            })
          }
        />
      ) : null}

      {kind === 'custom' ? (
        <CustomForm
          prefilledSid={prefilledSid}
          prefilledModule={prefilledModule && !isKnownModule(prefilledModule) ? prefilledModule : ''}
          soulsOptions={soulsOptions}
          pending={exec.isPending}
          error={exec.error}
          onSubmit={(v) =>
            exec.mutate({
              sid: v.sid,
              body: {
                module: v.module,
                input: jsonFallbackToInput(v),
                timeout_seconds: v.timeout_seconds,
                dry_run: v.dry_run,
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

// --- generic shared subcomponents (типизированы через FieldValues, без any) ---

interface SidFieldProps<T extends FieldValues> {
  prefilledSid: string;
  soulsOptions: string[];
  register: UseFormRegister<T>;
  errorMsg?: string;
  // Имя поля в схеме (у нас всегда `sid`, но typed-связь нужна для register).
  name: Path<T>;
}

function SidField<T extends FieldValues>({
  prefilledSid,
  soulsOptions,
  register,
  errorMsg,
  name,
}: SidFieldProps<T>) {
  if (prefilledSid) {
    return (
      <Input
        label="SID (FQDN)"
        readOnly
        mono
        {...register(name)}
        defaultValue={prefilledSid}
      />
    );
  }
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className={styles.metaKey}>SID (FQDN)</span>
      <input
        list="errand-sids"
        placeholder="host01.example.com"
        aria-invalid={errorMsg ? 'true' : undefined}
        {...register(name)}
        style={{
          ...selectStyle,
          border: errorMsg ? '1px solid var(--danger)' : '1px solid var(--border)',
          minWidth: 240,
        }}
      />
      <datalist id="errand-sids">
        {soulsOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {errorMsg ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{errorMsg}</span> : null}
    </label>
  );
}

interface EnvFieldsProps<T extends FieldValues> {
  fields: Array<{ id: string }>;
  append: (v: { key: string; value: string }) => void;
  remove: (i: number) => void;
  register: UseFormRegister<T>;
  // basePath — `env` или другое, мы передаём literal-name.
  basePath: ArrayPath<T>;
}

function EnvFields<T extends FieldValues>({
  fields,
  append,
  remove,
  register,
  basePath,
}: EnvFieldsProps<T>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className={styles.metaKey}>Env (опционально)</span>
      {fields.map((f, i) => (
        <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            placeholder="KEY"
            aria-label={`env key ${i}`}
            {...register(`${basePath}.${i}.key` as Path<T>)}
            style={{ ...selectStyle, minWidth: 160 }}
          />
          <input
            placeholder="value"
            aria-label={`env value ${i}`}
            {...register(`${basePath}.${i}.value` as Path<T>)}
            style={{ ...selectStyle, minWidth: 220 }}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`удалить env ${i}`}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '4px 8px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => append({ key: '', value: '' })}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)',
          padding: '4px 10px',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
        }}
      >
        <Plus size={14} /> добавить env
      </button>
    </div>
  );
}

function ErrorBlock({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className={styles.errorBox}>
      {error instanceof ApiError ? `Ошибка ${error.status}: ${error.message}` : String(error)}
    </div>
  );
}

function SubmitRow({ pending, label = 'Run Errand' }: { pending: boolean; label?: string }) {
  return (
    <div>
      <Button variant="primary" type="submit" disabled={pending}>
        <Send size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        {pending ? 'Запускаем…' : label}
      </Button>
    </div>
  );
}

interface CommonProps<T> {
  prefilledSid: string;
  soulsOptions: string[];
  pending: boolean;
  error: unknown;
  onSubmit: (v: T) => void;
}

function TimeoutAndDryRow<T extends FieldValues>({
  register,
  timeoutErr,
  timeoutName,
  dryName,
}: {
  register: UseFormRegister<T>;
  timeoutErr?: string;
  timeoutName: Path<T>;
  dryName: Path<T>;
}): ReactNode {
  return (
    <>
      <Input
        label="Timeout (s)"
        type="number"
        min={1}
        max={3600}
        {...register(timeoutName, { valueAsNumber: true })}
        error={timeoutErr}
        mono
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className={styles.metaKey}>Dry-run</span>
        <input
          type="checkbox"
          {...register(dryName)}
          style={{ width: 20, height: 20 }}
          aria-label="dry_run"
        />
      </label>
    </>
  );
}

// --- form variants ---

function ShellForm({ prefilledSid, soulsOptions, pending, error, onSubmit }: CommonProps<ShellInput>) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ShellInput>({
    resolver: zodResolver(shellSchema) as Resolver<ShellInput>,
    defaultValues: {
      module: 'core.cmd.shell',
      sid: prefilledSid,
      cmd: '',
      timeout_seconds: 30,
      cwd: '',
      env: [],
      dry_run: false,
    },
  });
  const envArr = useFieldArray({ control, name: 'env' });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={styles.section}
      aria-label="Параметры core.cmd.shell"
    >
      <input type="hidden" {...register('module')} value="core.cmd.shell" />
      <div className={styles.filters}>
        <SidField<ShellInput>
          prefilledSid={prefilledSid}
          soulsOptions={soulsOptions}
          register={register}
          name="sid"
          errorMsg={errors.sid?.message}
        />
        <TimeoutAndDryRow<ShellInput>
          register={register}
          timeoutErr={errors.timeout_seconds?.message}
          timeoutName="timeout_seconds"
          dryName="dry_run"
        />
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={styles.metaKey}>Command (sh -c)</span>
        <textarea
          rows={4}
          placeholder="uptime && df -h"
          aria-invalid={errors.cmd ? 'true' : undefined}
          {...register('cmd')}
          style={{
            ...textareaStyle,
            border: errors.cmd ? '1px solid var(--danger)' : '1px solid var(--border)',
          }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          параметр шлётся как <code>cmd</code> в API
        </span>
        {errors.cmd ? (
          <span style={{ color: 'var(--danger)', fontSize: 12 }}>{errors.cmd.message}</span>
        ) : null}
      </label>
      <Input
        label="Working dir (опционально)"
        placeholder="/var/tmp"
        hint="параметр шлётся как cwd в API"
        {...register('cwd')}
        mono
      />
      <EnvFields<ShellInput>
        fields={envArr.fields}
        append={envArr.append}
        remove={envArr.remove}
        register={register}
        basePath="env"
      />
      <ErrorBlock error={error} />
      <SubmitRow pending={pending} />
    </form>
  );
}

function ExecForm({ prefilledSid, soulsOptions, pending, error, onSubmit }: CommonProps<ExecInput>) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ExecInput>({
    resolver: zodResolver(execSchema) as Resolver<ExecInput>,
    defaultValues: {
      module: 'core.exec.run',
      sid: prefilledSid,
      cmd: '',
      args_raw: '',
      timeout_seconds: 30,
      cwd: '',
      env: [],
      dry_run: false,
    },
  });
  const envArr = useFieldArray({ control, name: 'env' });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={styles.section}
      aria-label="Параметры core.exec.run"
    >
      <input type="hidden" {...register('module')} value="core.exec.run" />
      <div className={styles.filters}>
        <SidField<ExecInput>
          prefilledSid={prefilledSid}
          soulsOptions={soulsOptions}
          register={register}
          name="sid"
          errorMsg={errors.sid?.message}
        />
        <TimeoutAndDryRow<ExecInput>
          register={register}
          timeoutErr={errors.timeout_seconds?.message}
          timeoutName="timeout_seconds"
          dryName="dry_run"
        />
      </div>
      <Input
        label="Binary (абсолютный путь)"
        placeholder="/usr/bin/uptime"
        aria-invalid={errors.cmd ? 'true' : undefined}
        {...register('cmd')}
        error={errors.cmd?.message}
        hint="параметр шлётся как cmd в API"
        mono
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={styles.metaKey}>Args (одна строка = один аргумент)</span>
        <textarea
          rows={4}
          placeholder={'--verbose\n-c\n3'}
          {...register('args_raw')}
          style={textareaStyle}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          параметр шлётся как <code>args</code> в API
        </span>
      </label>
      <Input
        label="Working dir (опционально)"
        placeholder="/var/tmp"
        hint="параметр шлётся как cwd в API"
        {...register('cwd')}
        mono
      />
      <EnvFields<ExecInput>
        fields={envArr.fields}
        append={envArr.append}
        remove={envArr.remove}
        register={register}
        basePath="env"
      />
      <ErrorBlock error={error} />
      <SubmitRow pending={pending} />
    </form>
  );
}

function CustomForm({
  prefilledSid,
  prefilledModule,
  soulsOptions,
  pending,
  error,
  onSubmit,
}: CommonProps<JsonFallbackInput> & { prefilledModule: string }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<JsonFallbackInput>({
    resolver: zodResolver(jsonFallbackSchema) as Resolver<JsonFallbackInput>,
    defaultValues: {
      module: prefilledModule || 'core.http.probe',
      sid: prefilledSid,
      params_json: '{}',
      timeout_seconds: 30,
      dry_run: false,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={styles.section} aria-label="Custom module">
      <div className={styles.filters}>
        <Input
          label="Module name"
          placeholder="core.http.probe"
          {...register('module')}
          error={errors.module?.message}
          mono
        />
        <SidField<JsonFallbackInput>
          prefilledSid={prefilledSid}
          soulsOptions={soulsOptions}
          register={register}
          name="sid"
          errorMsg={errors.sid?.message}
        />
        <TimeoutAndDryRow<JsonFallbackInput>
          register={register}
          timeoutErr={errors.timeout_seconds?.message}
          timeoutName="timeout_seconds"
          dryName="dry_run"
        />
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={styles.metaKey}>Input (JSON-object)</span>
        <textarea
          rows={8}
          placeholder='{"url": "https://example.com"}'
          aria-invalid={errors.params_json ? 'true' : undefined}
          {...register('params_json')}
          style={{
            ...textareaStyle,
            border: errors.params_json ? '1px solid var(--danger)' : '1px solid var(--border)',
          }}
        />
        {errors.params_json ? (
          <span style={{ color: 'var(--danger)', fontSize: 12 }}>{errors.params_json.message}</span>
        ) : null}
      </label>
      <ErrorBlock error={error} />
      <SubmitRow pending={pending} />
    </form>
  );
}
