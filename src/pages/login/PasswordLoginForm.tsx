import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../../components/primitives';
import { loginErrorMessage } from './loginErrorMessage';
import styles from '../Login.module.css';

const schema = z.object({
  login: z.string().trim().min(1, 'admin:loginErrLoginRequired'),
  password: z.string().min(1, 'admin:loginErrPasswordRequired'),
});

type Values = z.infer<typeof schema>;

export interface PasswordLoginFormProps {
  // The login and the password go here; it rejects with the error of the
  // refusal — an ApiError, a NetworkError, or a login error of useAuth
  // (SessionNotKeptError, LoginSupersededError) — each turned into a message by
  // loginErrorMessage. A local login passes useAuth().loginWithPassword.
  submit: (login: string, password: string) => Promise<void>;
  onSuccess: () => void;
  // What the login field is called: the AID for a local password, a directory
  // user name for LDAP.
  loginLabel: string;
  hint: string;
  // The i18n key a 401 shows ("wrong AID or password").
  rejectedKey: string;
  // data-testid prefix, one per method ("login-local").
  testId: string;
}

// A login + password form. One component for every method that takes a login
// and a password; the method is the `submit` it is given.
export function PasswordLoginForm({ submit, onSuccess, loginLabel, hint, rejectedKey, testId }: PasswordLoginFormProps) {
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { login: '', password: '' } });

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await submit(values.login.trim(), values.password);
      onSuccess();
    } catch (err) {
      setServerError(loginErrorMessage(err, rejectedKey));
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate data-testid={`${testId}-form`}>
      <label className={styles.field}>
        {loginLabel}
        <input
          className={styles.input}
          type="text"
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="off"
          data-testid={`${testId}-login`}
          aria-invalid={errors.login ? 'true' : undefined}
          {...register('login')}
        />
        {errors.login?.message ? <span className={styles.error}>{t(errors.login.message)}</span> : null}
      </label>
      <label className={styles.field}>
        {t('admin:loginPasswordLabel')}
        <input
          className={styles.input}
          type="password"
          autoComplete="current-password"
          data-testid={`${testId}-password`}
          aria-invalid={errors.password ? 'true' : undefined}
          {...register('password')}
        />
        {errors.password?.message ? (
          <span className={styles.error}>{t(errors.password.message)}</span>
        ) : (
          <span className={styles.hint}>{hint}</span>
        )}
      </label>
      {serverError ? <div className={styles.error} data-testid="login-error">{serverError}</div> : null}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={isSubmitting} data-testid={`${testId}-submit`}>
          {isSubmitting ? t('loggingIn') : t('login')}
        </Button>
      </div>
    </form>
  );
}
