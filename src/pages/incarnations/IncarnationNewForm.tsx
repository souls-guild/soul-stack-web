import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box } from 'lucide-react';
import { Button, Input } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { ChipsInput } from './ChipsInput';
import {
  incarnationCreateSchema,
  type IncarnationCreateFormInput,
  type IncarnationCreateFormOutput,
} from './schemas';
import styles from '../common.module.css';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function IncarnationNewForm() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdApplyId, setCreatedApplyId] = useState<string | null>(null);

  const services = useQuery({
    queryKey: ['services.list'],
    queryFn: () => keeperApi.services.list(),
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<IncarnationCreateFormInput, unknown, IncarnationCreateFormOutput>({
    resolver: zodResolver(incarnationCreateSchema),
    defaultValues: { name: '', service: '', covens: [], inputJson: '' },
  });

  const createMu = useMutation({
    mutationFn: (values: IncarnationCreateFormOutput) =>
      keeperApi.incarnations.create({
        name: values.name,
        service: values.service,
        covens: values.covens,
        input: values.inputJson,
      }),
    onSuccess: (reply) => {
      setCreatedApplyId(reply.apply_id);
      // На detail-странице уже видно текущий статус через get(); сразу туда.
      setTimeout(() => navigate(`/incarnations/${encodeURIComponent(reply.incarnation)}`), 600);
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
    },
  });

  async function onSubmit(values: IncarnationCreateFormOutput) {
    setServerError(null);
    setCreatedApplyId(null);
    createMu.mutate(values);
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
            Covens (declared environment-теги, ADR-008)
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Input scenario create (JSON-объект)
          </span>
          <textarea
            placeholder='{}'
            rows={8}
            spellCheck={false}
            {...register('inputJson')}
            aria-invalid={errors.inputJson ? 'true' : undefined}
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
              Передаётся как <code className="mono">input</code> в <code className="mono">scenario create</code>.
              Пустое = <code className="mono">{'{}'}</code>.
            </span>
          )}
        </label>

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
