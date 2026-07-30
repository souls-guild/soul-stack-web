import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/primitives';
import { useAuth } from '../hooks/useAuth';
import { ApiError, NetworkError } from '../api/client';
import styles from './Login.module.css';

// JWT — 3 base64url segments separated by dots. We don't validate content —
// authoritative check happens on the Keeper side.
// Messages — i18n keys in the `admin` namespace; rendered via t(fieldError.message).
const schema = z.object({
  token: z
    .string()
    .trim()
    .min(1, 'admin:loginErrTokenRequired')
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'admin:loginErrTokenFormat'),
});

type Values = z.infer<typeof schema>;

interface LocationState {
  from?: { pathname?: string; search?: string; hash?: string };
}

// Where an authenticated operator belongs. ProtectedRoute hands over the whole
// location it interrupted, and the query string is where the operator's filter
// lives — coming back to the bare path loses their work and reads as "it did
// not return me at all".
//
// Both the post-login navigation and the already-authenticated redirect below
// go through this. They used to disagree, and the redirect — which ignored the
// origin entirely — won the race after login, so nobody was ever returned. The
// fix is not to win that race but to remove it: one destination, one rule.
function returnTo(state: unknown): string {
  const from = (state as LocationState | undefined)?.from;
  if (!from?.pathname) return '/incarnations';
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

export function Login() {
  const { t } = useTranslation();
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
    return <Navigate to={returnTo(location.state)} replace />;
  }

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await loginWithToken(values.token);
      navigate(returnTo(location.state), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(
          err.status === 401
            ? t('admin:loginErrRejected')
            : `${t('admin:loginErrKeeperPrefix')} ${err.message}`,
        );
      } else if (err instanceof NetworkError) {
        setServerError(t('admin:loginErrNetwork'));
      } else {
        setServerError(err instanceof Error ? err.message : t('admin:loginErrUnknown'));
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
            <p className={styles.subtitle}>{t('admin:loginSubtitle')}</p>
          </div>
        </div>
        <label className={styles.field}>
          {t('admin:loginTokenLabel')}
          <textarea
            className={styles.tokenArea}
            placeholder={t('admin:loginTokenPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            data-testid="login-token-input"
            aria-invalid={errors.token ? 'true' : undefined}
            {...register('token')}
          />
          {errors.token ? (
            <span className={styles.error}>{errors.token.message ? t(errors.token.message) : null}</span>
          ) : (
            <span className={styles.hint}>{t('admin:loginHint')}</span>
          )}
        </label>
        {serverError ? <div className={styles.error} data-testid="login-error">{serverError}</div> : null}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={isSubmitting} data-testid="login-submit">
            {isSubmitting ? t('loggingIn') : t('login')}
          </Button>
        </div>
      </form>
    </div>
  );
}
