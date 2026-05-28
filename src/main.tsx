import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import './styles/tokens.css';
import './styles/base.css';

// Apply theme до React-mount, чтобы избежать FOUC.
(function applyStoredTheme() {
  try {
    const stored = window.localStorage.getItem('theme');
    const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const dark = mode === 'dark'
      || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  } catch {
    // ignore
  }
})();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
