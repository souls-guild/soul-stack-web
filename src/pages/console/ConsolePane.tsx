import { Suspense, lazy, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Badge, Dot } from '../../components/primitives';
import type { DotKind } from '../../components/primitives';
import type { ConsoleSession, ConsoleSessionStore } from './consoleSessionStore';
import styles from './MultiConsole.module.css';

// xterm + its addons are ~300 KB and only this page needs them; keeping them out
// of the main chunk costs every other page nothing.
const TerminalView = lazy(() => import('./TerminalView').then((m) => ({ default: m.TerminalView })));

interface Props {
  session: ConsoleSession;
  store: ConsoleSessionStore;
  focused: boolean;
  // Armed for group sends. Typing directly into the terminal is unaffected —
  // the checkbox governs only what a tab's input reaches.
  selected: boolean;
  onToggleSelected: (sid: string) => void;
  // Group values this host carries on the active grouping dimension; empty
  // when nothing is grouped.
  labels: readonly string[];
  // Filtered out by the only-matches switch. Kept mounted: unmounting would
  // dispose the terminal and lose the session's scrollback.
  hidden: boolean;
  fontSize: number;
  searchQuery: string;
  onToggleFocus: (sid: string) => void;
}

function dotKind(status: ConsoleSession['status']): DotKind {
  switch (status) {
    case 'open':
      return 'ok';
    case 'connecting':
      return 'info';
    case 'error':
      return 'off';
    default:
      return 'idle';
  }
}

export function ConsolePane({
  session,
  store,
  focused,
  selected,
  onToggleSelected,
  labels,
  hidden,
  fontSize,
  searchQuery,
  onToggleFocus,
}: Props) {
  const { t } = useTranslation();
  const { sid, status } = session;

  const subscribeOutput = useCallback(
    (cb: (bytes: Uint8Array) => void) => store.subscribeOutput(sid, cb),
    [store, sid],
  );
  const onInput = useCallback((data: string) => store.sendInput(sid, data), [store, sid]);
  const onResize = useCallback((cols: number, rows: number) => store.resize(sid, cols, rows), [store, sid]);

  const paneClass = [
    styles.pane,
    focused ? styles.paneFocused : '',
    hidden ? styles.paneHidden : '',
    status === 'error' ? styles.paneError : '',
    selected ? styles.paneArmed : styles.paneMuted,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={paneClass} data-testid={`pane-${sid}`} aria-label={`Console ${sid}`}>
      <header className={styles.paneHead}>
        <input
          type="checkbox"
          className={styles.paneCheck}
          checked={selected}
          onChange={() => onToggleSelected(sid)}
          aria-label={t('console:paneSelect', { sid })}
          data-testid={`pane-select-${sid}`}
        />
        <Dot kind={dotKind(status)} title={status} />
        <span className={styles.paneName} title={sid}>
          {sid}
        </span>
        {labels.map((label) => (
          <span key={label} className={styles.groupBadge} data-testid={`pane-group-${sid}-${label}`}>
            {label}
          </span>
        ))}
        {status === 'connecting' ? (
          <span className={styles.paneMeta}>{t('console:statusConnecting')}</span>
        ) : null}
        {session.exitCode !== null ? (
          <Badge tone={session.exitCode === 0 ? 'muted' : 'danger'}>
            {t('console:exitCode', { code: session.exitCode })}
          </Badge>
        ) : null}
        {session.error ? (
          <Badge tone="danger" title={session.error}>
            {session.error}
          </Badge>
        ) : null}
        <span className={styles.paneActions}>
          <button
            type="button"
            className={styles.paneIcon}
            onClick={() => onToggleFocus(sid)}
            aria-label={focused ? t('console:paneCollapse') : t('console:paneExpand')}
            data-testid={`pane-focus-${sid}`}
          >
            {focused ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </span>
      </header>

      <Suspense fallback={<div className={styles.term} />}>
        <TerminalView
          label={sid}
          subscribeOutput={subscribeOutput}
          onInput={onInput}
          onResize={onResize}
          searchQuery={searchQuery}
          interactive={status === 'open'}
          fontSize={fontSize}
        />
      </Suspense>
    </section>
  );
}
