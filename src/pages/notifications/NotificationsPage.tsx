import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HeraldsTab } from './HeraldsTab';
import { TidingsTab } from './TidingsTab';
import styles from '../common.module.css';

type Tab = 'heralds' | 'tidings';

export function NotificationsPage() {
  const { t } = useTranslation('notifications');
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: Tab = rawTab === 'tidings' ? 'tidings' : 'heralds';

  const setTab = useCallback(
    (next: Tab) => {
      setSearchParams(next === 'heralds' ? {} : { tab: next }, { replace: true });
    },
    [setSearchParams],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Bell size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            {t('pageTitle')}
          </h1>
          <div className={styles.crumbs}>{t('crumbs')}</div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          marginBottom: 24,
        }}
      >
        <TabBtn
          active={tab === 'heralds'}
          onClick={() => setTab('heralds')}
          data-testid="tab-heralds"
        >
          {t('tabHeralds')}
        </TabBtn>
        <TabBtn
          active={tab === 'tidings'}
          onClick={() => setTab('tidings')}
          data-testid="tab-tidings"
        >
          {t('tabTidings')}
        </TabBtn>
      </div>

      {tab === 'heralds' ? <HeraldsTab /> : <TidingsTab />}
    </div>
  );
}

interface TabBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  children: React.ReactNode;
}

function TabBtn({ active, children, ...rest }: TabBtnProps) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        padding: '8px 16px',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        fontSize: 14,
        marginBottom: -1,
        transition: 'color 0.15s',
      }}
    >
      {children}
    </button>
  );
}
