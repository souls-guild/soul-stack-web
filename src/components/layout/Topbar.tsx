import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import styles from './Topbar.module.css';

function initialsOf(aid: string): string {
  // archon-alice-ops → "AA"
  const parts = aid.replace(/^archon-/, '').split(/[-_]/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Topbar() {
  const { t } = useTranslation();
  const { identity, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const onSettings = location.pathname.startsWith('/settings');

  // Remember the last NON-settings screen so exiting settings always returns
  // there — robust to repeated gear clicks and switching settings sub-tabs
  // (navigate(-1) would land on a previous /settings/* entry and appear stuck).
  useEffect(() => {
    if (!onSettings) {
      sessionStorage.setItem('settings.returnTo', location.pathname + location.search);
    }
  }, [onSettings, location.pathname, location.search]);

  // Gear is a toggle: on a settings screen → return to the remembered screen
  // (default landing as a fallback); otherwise → open settings.
  function toggleSettings() {
    if (onSettings) {
      navigate(sessionStorage.getItem('settings.returnTo') || '/overview');
    } else {
      navigate('/settings/appearance');
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function onLogout() {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <div className={styles.mark}>SS</div>
        <span className={styles.name}>Soul Stack</span>
        <span className={styles.sep}>/</span>
        <span className={styles.sub}>Keeper UI</span>
      </div>
      <div className={styles.right}>
        <button
          type="button"
          onClick={toggleSettings}
          className={styles.settingsLink}
          title={t('common:settings')}
          aria-label={t('common:settings')}
          aria-pressed={onSettings}
          data-testid="topbar-settings-link"
        >
          <Settings size={16} />
        </button>
        {identity ? (
          <div className={styles.menu} ref={menuRef}>
            <button
              type="button"
              className={styles.chip}
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <span className={styles.avatar}>{initialsOf(identity.aid)}</span>
              <span className="mono">{identity.aid}</span>
            </button>
            {open ? (
              <div className={styles.menuList} role="menu">
                <div className={styles.menuMeta}>
                  AID: {identity.aid}
                  {identity.expiresAt ? (
                    <>
                      <br />
                      JWT exp: {identity.expiresAt.toISOString().slice(0, 19).replace('T', ' ')}
                    </>
                  ) : null}
                </div>
                <button type="button" className={styles.menuItem} onClick={onLogout}>
                  {t('logout')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
