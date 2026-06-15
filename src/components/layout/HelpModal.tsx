import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, FileText, KeyRound } from 'lucide-react';
import { Modal } from '../primitives';
import styles from './HelpModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Endpoint-адреса берём в первую очередь из vite-env (VITE_KEEPER_API / VITE_KEEPER_MCP);
// если не заданы — собираем относительно текущего window.location: keeper и MCP по
// умолчанию слушают 8080 / 8081 (см. ADR-004, keeper.yml `listen.openapi.addr` / `listen.mcp.addr`).
function getKeeperBase(): string {
  const fromEnv = import.meta.env.VITE_KEEPER_API as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.protocol && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
}

function getMcpBase(): string {
  const fromEnv = import.meta.env.VITE_KEEPER_MCP as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.protocol && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8081`;
  }
  return 'http://localhost:8081';
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard может быть недоступен (http-context) — fallback в select-and-copy:
      // показываем prompt с готовым значением, чтобы оператор не упёрся в тупик.
      window.prompt(t('admin:helpCopyPrompt'), value);
    }
  }
  return (
    <button type="button" className={styles.copy} onClick={onCopy} aria-label={label}>
      <Copy size={12} /> {copied ? t('admin:helpCopied') : t('admin:helpCopy')}
    </button>
  );
}

export function HelpModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const keeperBase = getKeeperBase();
  const mcpBase = getMcpBase();
  const docsUrl = `${keeperBase}/docs`;
  return (
    <Modal open={open} title={t('admin:helpTitle')} onClose={onClose}>
      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.h}>{t('admin:helpOpenapiTitle')}</h3>
          <p className={styles.lead}>{t('admin:helpOpenapiLead')}</p>
          <div className={styles.row}>
            <code className={`mono ${styles.url}`}>{docsUrl}</code>
            <div className={styles.actions}>
              <CopyButton value={docsUrl} label={t('admin:helpOpenapiCopyAria')} />
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkBtn}
              >
                <ExternalLink size={12} /> {t('admin:helpOpen')}
              </a>
            </div>
          </div>
          <p className={`${styles.hint} ${styles.hintJwt}`}>
            <KeyRound size={11} />
            {t('admin:helpOpenapiJwtHint')}
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.h}>{t('admin:helpMcpTitle')}</h3>
          <p className={styles.lead}>{t('admin:helpMcpLead')}</p>
          <div className={styles.row}>
            <code className={`mono ${styles.url}`}>{mcpBase}</code>
            <div className={styles.actions}>
              <CopyButton value={mcpBase} label={t('admin:helpMcpCopyAria')} />
            </div>
          </div>
          <p className={styles.hint}>{t('admin:helpMcpHint')}</p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.h}>{t('admin:helpDocsTitle')}</h3>
          <p className={styles.lead}>{t('admin:helpDocsLead')}</p>
          <div className={styles.row}>
            <a
              href="https://github.com/soul-stack/soul-stack/blob/main/docs/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkBtn}
            >
              <FileText size={12} /> docs/README.md
            </a>
            <a
              href="https://github.com/soul-stack/soul-stack/blob/main/docs/architecture.md"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkBtn}
            >
              <FileText size={12} /> architecture.md
            </a>
          </div>
        </section>
      </div>
    </Modal>
  );
}
