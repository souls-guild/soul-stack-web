import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../../components/primitives';
import { useAuth } from '../../hooks/useAuth';
import { loginErrorMessage } from './loginErrorMessage';
import styles from '../Login.module.css';

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

// Pasting an operator JWT — the login that always exists.
// onTyped reports whether the field holds anything, so the page does not swap
// the form away from under a token being pasted.
export function TokenLoginForm({ onSuccess, onTyped }: { onSuccess: () => void; onTyped?: (typed: boolean) => void }) {
  const { t } = useTranslation();
  const { loginWithToken } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { token: '' } });

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await loginWithToken(values.token);
      onSuccess();
    } catch (err) {
      setServerError(loginErrorMessage(err, 'admin:loginErrRejected'));
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate data-testid="login-token-form">
      <label className={styles.field}>
        {t('admin:loginTokenLabel')}
        <textarea
          className={styles.tokenArea}
          placeholder={t('admin:loginTokenPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          data-testid="login-token-input"
          aria-invalid={errors.token ? 'true' : undefined}
          {...register('token', { onChange: (e) => onTyped?.(e.target.value !== '') })}
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
  );
}
