import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { AuthContext } from '../../hooks/useAuth';
import styles from '../common.module.css';

// "Password" on the card of a local Archon (NIM-1051): an administrator sets
// or resets it. The Keeper ends every web session of the Archon and revokes the
// personal tokens it issued itself on success, so whoever held the old password
// is logged out everywhere. Shown only to a caller holding operator.set-password
// (optimistically while that loads). On the caller's own card it points to the
// Profile instead: Keeper refuses one's own AID here, as this route asks for no
// current password.
export function ArchonPasswordSection({ aid }: { aid: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  // Read without useAuth: the card also renders outside an AuthProvider (tests).
  const callerAID = useContext(AuthContext)?.identity?.aid;
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);

  const setMut = useMutation({
    mutationFn: () => keeperApi.operators.setPassword(aid, password),
    onSuccess: () => {
      setPassword('');
      setRepeat('');
      setDone(true);
      void qc.invalidateQueries({ queryKey: ['operator.jwts', aid] });
    },
  });

  if (!hasPermission('operator.set-password')) return null;

  if (callerAID === aid) {
    return (
      <section className={styles.section} aria-label={t('pages:archonPasswordSection')} data-testid="archon-password-section">
        <h2 className={styles.sectionTitle}>{t('pages:archonPasswordSection')}</h2>
        <p style={{ margin: 0, fontSize: 13 }} role="note" data-testid="archon-password-own">
          {t('pages:archonPasswordOwn')} <Link to="/profile/password">{t('pages:archonPasswordOwnLink')}</Link>
        </p>
      </section>
    );
  }

  // The Keeper owns the policy; here only that the two match.
  const mismatch = repeat !== '' && password !== repeat;
  const ready = password !== '' && password === repeat;

  return (
    <section className={styles.section} aria-label={t('pages:archonPasswordSection')} data-testid="archon-password-section">
      <h2 className={styles.sectionTitle}>{t('pages:archonPasswordSection')}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('pages:archonPasswordHint')}</p>
      <div className={styles.filters}>
        <Input
          label={t('pages:archonPasswordNew')}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setDone(false); }}
          data-testid="archon-password-new"
        />
        <Input
          label={t('pages:archonPasswordRepeat')}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => { setRepeat(e.target.value); setDone(false); }}
          error={mismatch ? t('pages:archonPasswordMismatch') : undefined}
          data-testid="archon-password-repeat"
        />
        <div style={{ alignSelf: 'flex-end' }}>
          <Button
            variant="danger"
            disabled={!ready || setMut.isPending}
            onClick={() => { setDone(false); setMut.mutate(); }}
            data-testid="archon-password-set"
          >
            {setMut.isPending ? t('saving') : t('pages:archonPasswordSet')}
          </Button>
        </div>
      </div>
      {setMut.error ? (
        <div className={styles.errorBox} role="alert">
          {setMut.error instanceof ApiError
            ? t('errors:generic', { status: setMut.error.status, detail: setMut.error.message })
            : String(setMut.error)}
        </div>
      ) : null}
      {done ? (
        <div role="status" data-testid="archon-password-done">{t('pages:archonPasswordSetDone', { aid })}</div>
      ) : null}
    </section>
  );
}
