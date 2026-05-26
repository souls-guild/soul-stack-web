import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/primitives';
import { useAuth } from '../hooks/useAuth';
import { ApiError, NetworkError } from '../api/client';
import styles from './Login.module.css';

// JWT — 3 base64url-сегмента, разделённых точкой. Контент не валидируем —
// authoritative проверка на стороне Keeper-а.
const schema = z.object({
  token: z
    .string()
    .trim()
    .min(1, 'вставьте JWT-токен Архонта')
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'не похоже на JWT (ожидается три base64url-сегмента через точку)'),
});

type Values = z.infer<typeof schema>;

interface LocationState {
  from?: { pathname?: string };
}

export function Login() {
  const { loginWithToken, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { token: '' },
  });

  if (isAuthenticated) {
    return <Navigate to="/incarnations" replace />;
  }

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await loginWithToken(values.token);
      const from = (location.state as LocationState | undefined)?.from?.pathname ?? '/incarnations';
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.status === 401 ? 'Keeper отверг токен (401).' : `Keeper вернул ошибку: ${err.message}`);
      } else if (err instanceof NetworkError) {
        setServerError('Не удалось связаться с Keeper. Проверьте, что Operator API доступен.');
      } else {
        setServerError(err instanceof Error ? err.message : 'неизвестная ошибка');
      }
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.brand}>
          <div className={styles.mark}>SS</div>
          <div>
            <h1 className={styles.title}>Soul Stack</h1>
            <p className={styles.subtitle}>Keeper UI · вход Архонта</p>
          </div>
        </div>
        <label className={styles.field}>
          JWT-токен
          <textarea
            className={styles.tokenArea}
            placeholder="eyJhbGciOiJI..."
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errors.token ? 'true' : undefined}
            {...register('token')}
          />
          {errors.token ? (
            <span className={styles.error}>{errors.token.message}</span>
          ) : (
            <span className={styles.hint}>
              Bootstrap-токен из файла, выданного <code className="mono">keeper init --archon</code>, либо токен,
              выданный <code className="mono">POST /v1/operators/{'{aid}'}/issue-token</code>.
            </span>
          )}
        </label>
        {serverError ? <div className={styles.error}>{serverError}</div> : null}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Проверяем…' : 'Войти'}
          </Button>
        </div>
      </form>
    </div>
  );
}
