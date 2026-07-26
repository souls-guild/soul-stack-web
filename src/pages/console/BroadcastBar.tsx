import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Radio } from 'lucide-react';
import { Button } from '../../components/primitives';
import styles from './MultiConsole.module.css';

interface Props {
  // The tab this input belongs to. Each tab keeps its own draft, so a
  // half-typed command survives switching away and back — and, more to the
  // point, a line typed for one group can never be sent to another.
  tabLabel: string;
  value: string;
  onChange: (next: string) => void;
  // Returns how many sessions actually received the line.
  onSend: () => number;
  // Armed AND open consoles in this tab — what the send would actually reach.
  liveCount: number;
  // Consoles in the tab at all; distinguishes "empty tab" from "none armed".
  tabCount: number;
  lastSent: number | null;
}

export function BroadcastBar({ tabLabel, value, onChange, onSend, liveCount, tabCount, lastSent }: Props) {
  const { t } = useTranslation();
  // Everything in the tab was unchecked — say so rather than leaving a dead
  // button the operator has to reason about.
  const noneArmed = tabCount > 0 && liveCount === 0;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (value.trim() !== '' && liveCount > 0) onSend();
    }
  }

  return (
    <div className={styles.broadcast}>
      <div className={styles.broadcastInner}>
        {noneArmed ? (
          <span className={styles.broadcastWarn} data-testid="console-none-selected">
            <AlertTriangle size={13} />
            {t('console:noneSelected')}
          </span>
        ) : null}
        <div className={styles.broadcastPrompt}>
          <Radio size={14} />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('console:broadcastPlaceholder', { group: tabLabel })}
            aria-label={t('console:broadcastPlaceholder', { group: tabLabel })}
            data-testid="console-broadcast-input"
            disabled={liveCount === 0}
          />
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={onSend}
          disabled={liveCount === 0 || value.trim() === ''}
          data-testid="console-broadcast-send"
        >
          {/* Names the tab it fires at: this reaches a root shell on every host
              in the group, so the blast radius must be readable from the button
              itself, not inferred from which tab happens to be open. */}
          {t('console:broadcastAction')} → {tabLabel} ({liveCount})
        </Button>

        {lastSent !== null ? (
          <span className={styles.broadcastSent} role="status" data-testid="console-broadcast-status">
            {t('console:broadcastSent', { count: lastSent })}
          </span>
        ) : null}

        <span className={styles.broadcastHint}>{t('console:broadcastHint')}</span>
      </div>
    </div>
  );
}
