// Profile → Password (NIM-1051): a local Archon changes its own password,
// proving the current one (PUT /v1/me/password). Keeper ends the caller's
// web sessions but the one this page runs in, when it runs in one (a pasted
// token is not a session and is untouched); personal tokens stay.
// A wrong current password is 403 — the caller's token is fine, so it must not
// read as a sign-out.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import styles from '../common.module.css';
import own from './ProfilePage.module.css';

function changeError(err: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t('profile:passwordErrCurrent');
    if (err.status === 429) return t('profile:passwordErrThrottled');
    return t('errors:generic', { status: err.status, detail: err.message });
  }
  return err instanceof Error ? err.message : String(err);
}

export function MyPassword() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => keeperApi.me.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
    },
  });

  // The Keeper owns the policy; here only that the two new ones match.
  const mismatch = repeat !== '' && next !== repeat;
  const ready = current !== '' && next !== '' && next === repeat;
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setDone(false);
  };

  return (
    <section className={own.section} aria-label={t('profile:tabPassword')} data-testid="my-password">
      <div className={own.head}>
        <h2 className={styles.sectionTitle}>{t('profile:passwordTitle')}</h2>
        <p className={own.hint}>{t('profile:passwordHint')}</p>
      </div>
      <form
        className={own.passwordForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || change.isPending) return;
          setDone(false);
          change.mutate();
        }}
      >
        <Input
          label={t('profile:passwordCurrent')}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={edit(setCurrent)}
          data-testid="my-password-current"
        />
        <Input
          label={t('profile:passwordNew')}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={edit(setNext)}
          data-testid="my-password-new"
        />
        <Input
          label={t('profile:passwordRepeat')}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={edit(setRepeat)}
          error={mismatch ? t('profile:passwordMismatch') : undefined}
          data-testid="my-password-repeat"
        />
        <div>
          <Button type="submit" variant="primary" disabled={!ready || change.isPending} data-testid="my-password-submit">
            {change.isPending ? t('saving') : t('profile:passwordSubmit')}
          </Button>
        </div>
      </form>
      {change.error ? (
        <div className={styles.errorBox} role="alert" data-testid="my-password-error">
          {changeError(change.error, t)}
        </div>
      ) : null}
      {done ? (
        <div role="status" data-testid="my-password-done">
          {t('profile:passwordChanged')} <Link to="/profile/tokens">{t('profile:passwordTokensLink')}</Link>
        </div>
      ) : null}
    </section>
  );
}
