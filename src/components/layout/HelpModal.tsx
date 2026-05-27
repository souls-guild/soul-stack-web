import { useState } from 'react';
import { Copy, ExternalLink, FileText } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard может быть недоступен (http-context) — fallback в select-and-copy:
      // показываем prompt с готовым значением, чтобы оператор не упёрся в тупик.
      window.prompt('Скопируйте значение:', value);
    }
  }
  return (
    <button type="button" className={styles.copy} onClick={onCopy} aria-label={label}>
      <Copy size={12} /> {copied ? 'Скопировано' : 'Copy'}
    </button>
  );
}

export function HelpModal({ open, onClose }: Props) {
  const keeperBase = getKeeperBase();
  const mcpBase = getMcpBase();
  const openapiUrl = `${keeperBase}/openapi.yaml`;
  return (
    <Modal open={open} title="Помощь · Soul Stack Keeper" onClose={onClose}>
      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.h}>OpenAPI спецификация</h3>
          <p className={styles.lead}>
            Keeper отдаёт OpenAPI 3.1 spec по адресу <code className="mono">/openapi.yaml</code>.
            Используется для генерации клиентов и валидации запросов.
          </p>
          <div className={styles.row}>
            <code className={`mono ${styles.url}`}>{openapiUrl}</code>
            <div className={styles.actions}>
              <CopyButton value={openapiUrl} label="Скопировать OpenAPI URL" />
              <a
                href={openapiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkBtn}
              >
                <ExternalLink size={12} /> Открыть
              </a>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.h}>MCP endpoint</h3>
          <p className={styles.lead}>
            Model Context Protocol listener для интеграции с Claude Desktop и другими MCP-клиентами.
            Транспорт <code className="mono">stdio</code> поверх HTTP/SSE, см. <code className="mono">keeper.yml</code>{' '}
            <code className="mono">listen.mcp.addr</code>.
          </p>
          <div className={styles.row}>
            <code className={`mono ${styles.url}`}>{mcpBase}</code>
            <div className={styles.actions}>
              <CopyButton value={mcpBase} label="Скопировать MCP URL" />
            </div>
          </div>
          <p className={styles.hint}>
            Для Claude Desktop пропишите endpoint в <code className="mono">claude_desktop_config.json</code>{' '}
            под ключом <code className="mono">mcpServers.soul-stack</code>.
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.h}>Документация</h3>
          <p className={styles.lead}>
            Документация и ADR — в репозитории <code className="mono">soul-stack/docs/</code>.
          </p>
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
