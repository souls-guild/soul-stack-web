// Scope step of the multi-console: pick which VMs the session opens shells on,
// then connect.
//
// Deliberately an explicit step with an explicit button. Attaching a root shell
// to a set of production hosts is not something to do as a side effect of
// following a link, and the same screen is what the operator comes back to when
// the selection needs to change.

import { useTranslation } from 'react-i18next';
import { Plug, X } from 'lucide-react';
import { Badge, Button } from '../../components/primitives';
import { ChipsInput } from '../incarnations/ChipsInput';
import type { SoulListEntry } from '../../api/keeper';
import type { HostCriteria } from '../run/hostSelector';
import type { MembershipFailure, UnresolvedIncarnation } from '../run/useIncarnationMembers';
import { CONSOLE_SOFT_LIMIT } from './consoleSelection';
import styles from './MultiConsole.module.css';

// Incarnation / coven names are kebab-case (ADR-008).
const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PREVIEW_LIMIT = 40;

// An incarnation whose roster did not arrive contributes nothing, and the three
// causes are three different next steps for the operator: fix the name, ask for
// the permission, or retry. Silence would read as "that incarnation is empty".
const UNRESOLVED_KEY: Record<MembershipFailure, string> = {
  unknown: 'console:scopeIncarnationUnknown',
  forbidden: 'console:scopeIncarnationForbidden',
  failed: 'console:scopeIncarnationUnresolved',
};
const UNRESOLVED_REASONS = Object.keys(UNRESOLVED_KEY) as MembershipFailure[];

interface Props {
  value: HostCriteria;
  onChange: (next: HostCriteria) => void;
  matched: SoulListEntry[];
  loading: boolean;
  soulsUnavailable: boolean;
  invalidSoulprint: string[];
  regexError: string | null;
  hasCriteria: boolean;
  unresolvedIncarnations: UnresolvedIncarnation[];
  onConnect: () => void;
  // Present once a session is live — the step doubles as "change selection".
  onCancel: (() => void) | null;
  connectedCount: number;
}

export function ScopePicker({
  value,
  onChange,
  matched,
  loading,
  soulsUnavailable,
  invalidSoulprint,
  regexError,
  hasCriteria,
  unresolvedIncarnations,
  onConnect,
  onCancel,
  connectedCount,
}: Props) {
  const { t } = useTranslation();
  const sample = matched.slice(0, PREVIEW_LIMIT);
  const canConnect = hasCriteria && matched.length > 0 && !loading;

  return (
    <div className={styles.scope} data-testid="console-scope">
      <div className={styles.scopeHead}>
        <h2 className={styles.scopeTitle}>{t('console:scopeTitle')}</h2>
        <p className={styles.scopeHint}>{t('console:scopeHint')}</p>
      </div>

      {soulsUnavailable ? (
        <div className={`${styles.banner} ${styles.bannerDanger}`} data-testid="console-souls-error">
          {t('console:soulsUnavailable')}
        </div>
      ) : null}

      <div className={styles.scopeFields}>
        <div className={styles.scopeField} data-testid="console-scope-incarnations">
          <span className={styles.fieldLabel}>{t('console:scopeIncarnations')}</span>
          <ChipsInput
            value={value.incarnations}
            onChange={(next) => onChange({ ...value, incarnations: next })}
            placeholder={t('console:scopeIncarnationsPlaceholder')}
            ariaLabel={t('console:scopeIncarnations')}
            validate={(v) => (NAME_REGEX.test(v) ? null : t('console:scopeNameInvalid'))}
          />
          {UNRESOLVED_REASONS.map((reason) => {
            const names = unresolvedIncarnations.filter((u) => u.reason === reason).map((u) => u.name);
            if (names.length === 0) return null;
            return (
              <span key={reason} className={styles.scopeWarn} data-testid={`console-incarnation-${reason}`}>
                {t(UNRESOLVED_KEY[reason], { names: names.join(', ') })}
              </span>
            );
          })}
        </div>

        <div className={styles.scopeField} data-testid="console-scope-covens">
          <span className={styles.fieldLabel}>{t('console:scopeCovens')}</span>
          <ChipsInput
            value={value.covens}
            onChange={(next) => onChange({ ...value, covens: next })}
            placeholder={t('console:scopeCovensPlaceholder')}
            ariaLabel={t('console:scopeCovens')}
            validate={(v) => (NAME_REGEX.test(v) ? null : t('console:scopeNameInvalid'))}
          />
        </div>

        <label className={styles.scopeField}>
          <span className={styles.fieldLabel}>{t('console:scopeSidRegex')}</span>
          <input
            type="text"
            className={styles.scopeInput}
            value={value.sidRegex}
            onChange={(e) => onChange({ ...value, sidRegex: e.target.value })}
            placeholder={t('console:scopeSidRegexPlaceholder')}
            data-testid="console-scope-regex"
          />
          <span className={styles.scopeFieldHint}>{t('console:scopeSidRegexHint')}</span>
          {regexError ? <span className={styles.scopeWarn}>{regexError}</span> : null}
        </label>

        <label className={styles.scopeField}>
          <span className={styles.fieldLabel}>{t('console:scopeSoulprint')}</span>
          <input
            type="text"
            className={styles.scopeInput}
            value={value.soulprint}
            onChange={(e) => onChange({ ...value, soulprint: e.target.value })}
            placeholder={t('console:scopeSoulprintPlaceholder')}
            data-testid="console-scope-soulprint"
          />
          {invalidSoulprint.length > 0 ? (
            <span className={styles.scopeWarn}>
              {t('console:scopeSoulprintUnrecognized', { tokens: invalidSoulprint.join(', ') })}
            </span>
          ) : null}
        </label>
      </div>

      <div className={styles.scopePreview} data-testid="console-scope-preview">
        {!hasCriteria ? (
          <span className={styles.scopeMuted}>{t('console:scopeEmpty')}</span>
        ) : (
          <>
            <div className={styles.scopeCount}>
              <Badge tone={matched.length > 0 ? 'info' : 'warn'}>
                {t('console:scopeMatched', { count: matched.length })}
              </Badge>
              {loading ? <span className={styles.scopeMuted}>{t('console:scopeResolving')}</span> : null}
            </div>
            {matched.length > CONSOLE_SOFT_LIMIT ? (
              <div className={styles.scopeWarn} data-testid="console-scope-limit">
                {t('console:tooManyWarning', { count: matched.length })}
              </div>
            ) : null}
            {sample.length > 0 ? (
              <div className={styles.scopeList}>
                {sample.map((s) => (
                  <span key={s.sid} className={styles.scopeSid}>
                    {s.sid}
                  </span>
                ))}
                {matched.length > sample.length ? (
                  <span className={styles.scopeMuted}>
                    {t('console:scopeMore', { count: matched.length - sample.length })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {!loading && matched.length === 0 ? (
              <span className={styles.scopeWarn}>{t('console:scopeNoMatch')}</span>
            ) : null}
          </>
        )}
      </div>

      <div className={styles.scopeActions}>
        <Button
          type="button"
          variant="primary"
          onClick={onConnect}
          disabled={!canConnect}
          data-testid="console-connect"
        >
          <Plug size={15} />
          {connectedCount > 0
            ? t('console:reconnectScope', { count: matched.length })
            : t('console:connectAction', { count: matched.length })}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} data-testid="console-scope-cancel">
            <X size={15} />
            {t('console:scopeCancel')}
          </Button>
        ) : null}
        {connectedCount > 0 ? (
          <span className={styles.scopeMuted}>{t('console:scopeReplaceHint')}</span>
        ) : null}
      </div>
    </div>
  );
}
