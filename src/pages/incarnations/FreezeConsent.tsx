import { useTranslation } from 'react-i18next';
import type { Freeze } from '../../api/keeper';
import { browserTimeZone, formatInstant, withComment, type Weekday } from './maintenance';
import styles from '../common.module.css';

export function FreezeConsentBlock({
  freeze,
  refusal,
  consent,
  onConsentChange,
}: {
  freeze?: Freeze;
  refusal: string | null;
  consent: boolean;
  onConsentChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);
  return (
    <div className={styles.errorBox} style={{ marginTop: 12 }} data-testid="freeze-consent-block">
      {freeze ? (
        <div style={{ fontWeight: 500 }}>
          {withComment(
            t('incarnations:freezeNowTitle', { until: formatInstant(freeze.ends_at, browserTimeZone(), dayLabel) }),
            freeze.comment,
          )}
        </div>
      ) : null}
      {refusal ? <div>{t('incarnations:freezeRefused', { detail: refusal })}</div> : null}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsentChange(e.target.checked)}
          data-testid="freeze-consent"
        />
        {t('run:freezeConsentLabel')}
      </label>
    </div>
  );
}
