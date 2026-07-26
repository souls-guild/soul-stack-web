import { useTranslation } from 'react-i18next';
import { CheckSquare, Square } from 'lucide-react';
import styles from './MultiConsole.module.css';

interface Props {
  // Consoles in the active tab, and how many of them are armed.
  total: number;
  selected: number;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

// Arming controls for the active tab. Scoped to the tab on purpose: "select
// all" while looking at one group must not silently arm the rest of the wall.
export function SelectionToolbar({ total, selected, onSelectAll, onSelectNone }: Props) {
  const { t } = useTranslation();
  if (total === 0) return null;

  return (
    <div className={styles.selectionToolbar}>
      <span
        className={selected === 0 ? styles.selectionCountZero : styles.selectionCount}
        data-testid="console-selection-count"
      >
        {t('console:selectedOf', { selected, total })}
      </span>
      <button
        type="button"
        className={styles.selectionBtn}
        onClick={onSelectAll}
        disabled={selected === total}
        data-testid="console-select-all"
      >
        <CheckSquare size={13} />
        {t('console:selectAll')}
      </button>
      <button
        type="button"
        className={styles.selectionBtn}
        onClick={onSelectNone}
        disabled={selected === 0}
        data-testid="console-select-none"
      >
        <Square size={13} />
        {t('console:selectNone')}
      </button>
    </div>
  );
}
