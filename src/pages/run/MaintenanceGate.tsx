import { useTranslation } from 'react-i18next';
import { browserTimeZone, formatInstant, type Weekday } from '../incarnations/maintenance';
import { MAINTENANCE_PROBE_LIMIT, type MaintenanceProbe } from './maintenanceProbe';
import pageStyles from '../common.module.css';
import styles from './WizardSteps.module.css';

// The Run dialog's half of ADR-0093 (NIM-1076): «Провести в тех окно» with the next
// start of each target, and the mandatory freeze consent that keeps «Запустить»
// disabled until it is ticked.

const SHOWN_TARGETS = 5;

export function MaintenanceRunOptions({
  mode,
  inWindow,
  onInWindowChange,
  scheduled,
  probe,
  serverRefusal,
  consent,
  onConsentChange,
}: {
  mode: 'voyage' | 'cadence';
  inWindow: boolean;
  onInWindowChange: (v: boolean) => void;
  scheduled: boolean;
  probe: MaintenanceProbe;
  // The detail of a 409 freeze-active from the last submit, if any.
  serverRefusal: string | null;
  consent: boolean;
  onConsentChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const tz = browserTimeZone();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);
  const at = (iso: string) => formatInstant(iso, tz, dayLabel);

  if (mode === 'cadence') {
    return (
      <fieldset className={styles.optionsSection}>
        <legend className={styles.optionsSectionLegend}>{t('run:sectionMaintenanceLabel')}</legend>
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={inWindow}
            onChange={(e) => onInWindowChange(e.target.checked)}
            data-testid="cadence-in-window"
          />
          {t('run:cadenceInWindowLabel')}
        </label>
        <span className={styles.hint}>{t('run:cadenceInWindowHint')}</span>
      </fieldset>
    );
  }

  const needsConsent = !inWindow && (probe.frozen.length > 0 || serverRefusal !== null);
  const shown = probe.targets.slice(0, SHOWN_TARGETS);
  // A Voyage over several incarnations has one start (ADR-0093 §3): no earlier than the
  // latest of their own next starts. The exact moment is Keeper's to compute.
  const closedStarts = probe.targets
    .filter((x) => x.status && !x.status.open_now)
    .map((x) => x.status!.next_start)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const single = probe.targets.length === 1;
  const commonNotBefore = single ? undefined : closedStarts[closedStarts.length - 1];

  return (
    <fieldset className={styles.optionsSection} data-testid="run-maintenance">
      <legend className={styles.optionsSectionLegend}>{t('run:sectionMaintenanceLabel')}</legend>
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={inWindow}
          onChange={(e) => onInWindowChange(e.target.checked)}
          data-testid="run-in-window"
        />
        {t('run:inWindowLabel')}
      </label>
      <span className={styles.hint}>{t('run:inWindowHint')}</span>

      {probe.capped ? (
        <span className={styles.hint} data-testid="run-maintenance-capped">
          {t('run:maintenanceProbeCapped', { n: MAINTENANCE_PROBE_LIMIT })}
        </span>
      ) : null}

      {inWindow && shown.length > 0 ? (
        <ul style={listStyle} data-testid="run-next-starts">
          {/* One target: its line is the start. Several: each line is that
              incarnation's own window, and the start is the common line below. */}
          {shown.map((x) => (
            <li key={x.name}>
              {x.error
                ? t('run:maintenanceProbeFailed', { name: x.name, status: x.error })
                : !x.status || (x.status.open_now && !x.hasWindows)
                  ? t(single ? 'run:inWindowNoWindows' : 'run:inWindowTargetNoWindows', { name: x.name })
                  : x.status.open_now
                    ? t(single ? 'run:inWindowOpenNow' : 'run:inWindowTargetOpen', { name: x.name })
                    : t(single ? 'run:inWindowNext' : 'run:inWindowTargetFrom', { name: x.name, at: at(x.status.next_start) })}
            </li>
          ))}
          {probe.targets.length > SHOWN_TARGETS ? (
            <li>{t('run:inWindowMore', { n: probe.targets.length - SHOWN_TARGETS })}</li>
          ) : null}
        </ul>
      ) : null}
      {inWindow && commonNotBefore ? (
        <span className={styles.hint} data-testid="run-common-start">
          {t('run:inWindowCommonStart', { at: at(commonNotBefore) })}
        </span>
      ) : null}
      {inWindow && scheduled ? <span className={styles.hint}>{t('run:inWindowScheduleNote')}</span> : null}

      {needsConsent ? (
        <div className={pageStyles.errorBox} data-testid="run-freeze-block">
          <div style={{ fontWeight: 500 }}>{t('run:freezeActiveTitle')}</div>
          {probe.frozen.length > 0 ? (
            <ul style={{ ...listStyle, color: 'inherit' }}>
              {probe.frozen.map((x) => (
                <li key={x.name} data-testid={`run-frozen-${x.name}`}>
                  {t('run:freezeActiveRow', {
                    name: x.name,
                    comment: x.freeze?.comment ? t('incarnations:mwQuoted', { text: x.freeze.comment }) : '',
                    until: x.freeze ? at(x.freeze.ends_at) : '',
                  }).replace(/\s+/g, ' ')}
                </li>
              ))}
            </ul>
          ) : null}
          {serverRefusal ? <div>{t('run:freezeServerRefused', { detail: serverRefusal })}</div> : null}
          <label style={{ ...checkRowStyle, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => onConsentChange(e.target.checked)}
              data-testid="run-confirm-freeze"
            />
            {t('run:freezeConsentLabel')}
          </label>
          {!consent ? <span className={styles.hint}>{t('run:freezeConsentNeeded')}</span> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

const checkRowStyle: React.CSSProperties = { display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 };
const listStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)' };
