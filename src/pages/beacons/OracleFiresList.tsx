import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import styles from '../common.module.css';

// Placeholder. The spec mentions /v1/oracle/fires, but the endpoint is
// absent from the openapi spec — the screen stays empty until it appears (ADR-030 / Oracle).
// The current equivalent is filtering audit-log by type=decree.fired.
export function OracleFiresList() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('beacons:oracleFiresTitle')}</h1>
          <div className={styles.crumbs}>{t('beacons:oracleFiresSubtitle')}</div>
        </div>
      </div>

      <div className={styles.empty}>
        <Zap size={32} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        <p style={{ margin: '12px 0 8px' }}>
          <Trans i18nKey="beacons:oracleFiresTodo" components={{ code: <code className="mono" /> }} />
        </p>
        <p style={{ margin: 0, fontSize: 12.5 }}>
          <Trans
            i18nKey="beacons:oracleFiresWorkaround"
            components={{
              auditLink: <Link to="/audit" />,
              code: <code className="mono" />,
            }}
          />
        </p>
      </div>
    </div>
  );
}
