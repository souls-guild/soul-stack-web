import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Stamp } from 'lucide-react';
import { keeperApi, type PluginSigilAllowReply } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import styles from '../common.module.css';

// kebab-case; такой же pattern фигурирует в openapi для namespace/name плагинов.
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
// Tag-ref вида v1.2.3 (одиночный path-сегмент — branch-ref со слешем сервер
// откажет 422; см. описание /v1/plugins/sigils/{namespace}/{name}/{ref}).
const TAG_REF_RE = /^[A-Za-z0-9._-]+$/;

const schema = z.object({
  namespace: z
    .string()
    .trim()
    .min(1, 'обязательно')
    .regex(KEBAB_RE, 'kebab-case (^[a-z][a-z0-9-]*$)'),
  name: z
    .string()
    .trim()
    .min(1, 'обязательно')
    .regex(KEBAB_RE, 'kebab-case (^[a-z][a-z0-9-]*$)'),
  ref: z
    .string()
    .trim()
    .min(1, 'обязательно')
    .regex(TAG_REF_RE, 'одиночный path-сегмент (v1.2.3); branch-ref со слешем сервер откажет 422'),
});

type FormValues = z.infer<typeof schema>;

const NAMESPACE_HINT =
  'mod — soul_module / soul_beacon, cloud — cloud_driver, ssh — ssh_provider';

export function PluginRegisterForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reply, setReply] = useState<PluginSigilAllowReply | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { namespace: '', name: '', ref: '' },
  });

  const allowMut = useMutation({
    mutationFn: (body: FormValues) => keeperApi.plugins.sigils.allow(body),
    onSuccess: (data, vars) => {
      setReply(data);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ['plugins.sigils.list'] });
      // Не уходим со страницы сразу — оператор должен увидеть посчитанный sha256.
      // Кнопка «К записи» уведёт на detail после факт-чека.
      void vars;
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          setServerError(`Validation: ${err.detail || err.message}`);
        } else if (err.status === 404) {
          setServerError(
            `Плагин не найден в кеше host-а. Сперва задеплойте бинарь по namespace/name; ref — operator-asserted метка. ${err.detail}`,
          );
        } else if (err.status === 409) {
          setServerError(
            `Активный допуск на (namespace, name, ref) уже есть — сперва revoke. ${err.detail}`,
          );
        } else {
          setServerError(`Ошибка ${err.status}: ${err.message}`);
        }
      } else {
        setServerError(String(err));
      }
    },
  });

  function onSubmit(values: FormValues) {
    setReply(null);
    setServerError(null);
    allowMut.mutate(values);
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/plugins">plugins</Link> / <span>register</span>
        </div>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Stamp size={22} /> Допустить плагин в Sigil-allow-list
        </h1>
        <div className={styles.crumbs}>
          ADR-026 вариант C: Keeper читает бинарь + manifest из локального кеша
          host-а по <code className="mono">(namespace, name)</code> (single-slot),
          сам считает sha256 и подписывает блок Sigil-а. Клиент НЕ передаёт хеш
          или подпись. <code className="mono">ref</code> — operator-asserted метка
          версии (НЕ git-verified).
        </div>
      </div>

      <form className={styles.section} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.filters}>
          <Input
            label="Namespace"
            placeholder="mod / cloud / ssh"
            mono
            hint={NAMESPACE_HINT}
            error={errors.namespace?.message}
            {...register('namespace')}
          />
          <Input
            label="Name"
            placeholder="soul-mod-acme"
            mono
            hint="как в manifest.name (kebab-case)"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Ref"
            placeholder="v1.2.3"
            mono
            hint="tag-ref, одиночный path-сегмент"
            error={errors.ref?.message}
            {...register('ref')}
          />
          <div style={{ alignSelf: 'flex-end' }}>
            <Button type="submit" variant="primary" disabled={isSubmitting || allowMut.isPending}>
              {allowMut.isPending ? 'Допускаем…' : 'Допустить'}
            </Button>
          </div>
        </div>
        {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}
      </form>

      {reply ? (
        <section
          className={styles.section}
          aria-label="результат допуска"
          style={{
            background: 'color-mix(in srgb, var(--ok, #2e7d32) 6%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--ok, #2e7d32) 30%, var(--border))',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--s-4)',
          }}
        >
          <h2 className={styles.sectionTitle}>Плагин допущен</h2>
          <div className={styles.meta}>
            <span className={styles.metaKey}>Namespace</span>
            <span className={styles.metaVal}>{reply.namespace}</span>
            <span className={styles.metaKey}>Name</span>
            <span className={styles.metaVal}>{reply.name}</span>
            <span className={styles.metaKey}>Ref</span>
            <span className={styles.metaVal}>{reply.ref}</span>
            <span className={styles.metaKey}>SHA-256 (Keeper-side)</span>
            <span className={styles.metaVal}>{reply.sha256}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              onClick={() =>
                navigate(
                  `/plugins/${encodeURIComponent(reply.namespace)}/${encodeURIComponent(reply.name)}/${encodeURIComponent(reply.ref)}`,
                )
              }
            >
              К записи
            </Button>
            <Button variant="ghost" onClick={() => navigate('/plugins')}>К списку</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
