import { useTranslation } from 'react-i18next';
import { AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { ALL_TAB, type ConsoleGroup } from './consoleGrouping';
import styles from './MultiConsole.module.css';

interface Props {
  groups: ConsoleGroup[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  totalCount: number;
  onEditGroups: () => void;
}

export function GroupTabs({ groups, activeTab, onTabChange, totalCount, onEditGroups }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.groupBar}>
      <div className={styles.tabs} role="tablist" aria-label={t('console:groupTabsLabel')}>
        <button
          type="button"
          role="tab"
          className={activeTab === ALL_TAB ? styles.tabActive : styles.tab}
          aria-selected={activeTab === ALL_TAB}
          onClick={() => onTabChange(ALL_TAB)}
          data-testid="console-tab-all"
        >
          {t('console:tabAll')}
          <span className={styles.tabCount}>{totalCount}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            className={activeTab === g.id ? styles.tabActive : styles.tab}
            aria-selected={activeTab === g.id}
            onClick={() => onTabChange(g.id)}
            title={g.error ?? undefined}
            data-testid={`console-tab-${g.id}`}
          >
            {g.error ? <AlertTriangle size={12} className={styles.tabWarnIcon} /> : null}
            {g.name}
            <span className={styles.tabCount}>{g.sids.length}</span>
          </button>
        ))}
      </div>

      <button type="button" className={styles.groupsBtn} onClick={onEditGroups} data-testid="console-edit-groups">
        <SlidersHorizontal size={14} />
        {groups.length === 0 ? t('console:groupsCreate') : t('console:groupsEdit')}
      </button>
    </div>
  );
}
