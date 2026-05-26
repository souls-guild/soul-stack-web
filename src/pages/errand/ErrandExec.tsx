import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  keeperApi,
  type ErrandResult,
  type ErrandAccepted,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Input } from '../../components/primitives';
import styles from '../common.module.css';

const KNOWN_MODULES = ['core.cmd.shell', 'core.exec.run', 'core.http.probe'];
const TERMINAL: ReadonlySet<string> = new Set(['success', 'failed', 'timed_out', 'cancelled', 'module_not_allowed']);

function statusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success': return 'ok';
    case 'failed':
    case 'timed_out':
    case 'module_not_allowed': return 'danger';
    case 'cancelled': return 'muted';
    case 'running': return 'info';
    default: return 'muted';
  }
}

function isResult(v: ErrandResult | ErrandAccepted | undefined): v is ErrandResult {
  if (!v) return false;
  return v.status !== 'running' || 'started_at' in v;
}

function StreamBlock({ label, text, truncated }: { label: string; text?: string; truncated?: boolean }) {
  if (!text) return null;
  return (
    <details open style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <summary style={{ padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {label}{truncated ? ' · truncated' : ''}
      </summary>
      <pre
        style={{
          margin: 0,
          padding: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          maxHeight: 360,
          overflow: 'auto',
          background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {text}
        {truncated ? '\n[truncated at 64 KiB]' : ''}
      </pre>
    </details>
  );
}

export function ErrandExec() {
  const [sid, setSid] = useState('');
  const [moduleName, setModuleName] = useState(KNOWN_MODULES[0]);
  const [inputRaw, setInputRaw] = useState('{}');
  const [timeout, setTimeout] = useState<number>(30);
  const [dryRun, setDryRun] = useState(false);
  const [errandId, setErrandId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<ErrandResult | null>(null);

  const inputParsed = useMemo<{ ok: true; value: Record<string, unknown> } | { ok: false; err: string }>(() => {
    const t = inputRaw.trim();
    if (!t) return { ok: true, value: {} };
    try {
      const v = JSON.parse(t);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, err: 'input должен быть JSON-object' };
      }
      return { ok: true, value: v as Record<string, unknown> };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : 'invalid JSON' };
    }
  }, [inputRaw]);

  const exec = useMutation({
    mutationFn: () => {
      if (!inputParsed.ok) throw new Error(inputParsed.err);
      return keeperApi.souls.exec(sid, {
        module: moduleName,
        input: inputParsed.value,
        timeout_seconds: timeout,
        dry_run: dryRun,
      });
    },
    onSuccess: (resp) => {
      if (resp.kind === 'sync') {
        setSyncResult(resp.result);
        setErrandId(null);
      } else {
        setSyncResult(null);
        setErrandId(resp.accepted.errand_id);
      }
    },
  });

  useEffect(() => {
    if (exec.isPending) {
      setSyncResult(null);
      setErrandId(null);
    }
  }, [exec.isPending]);

  // Poll GET /v1/errands/{id} до терминала.
  const poll = useQuery({
    queryKey: ['errand.get', errandId],
    queryFn: () => keeperApi.errands.get(errandId!),
    enabled: !!errandId,
    refetchInterval: (q) => {
      const data = q.state.data as ErrandResult | ErrandAccepted | undefined;
      if (!data) return 1500;
      if ((data as ErrandAccepted).status === 'running' && !('started_at' in data)) return 1500;
      return TERMINAL.has((data as ErrandResult).status ?? '') ? false : 1500;
    },
  });

  const finalResult: ErrandResult | null = syncResult ?? (isResult(poll.data) ? (poll.data as ErrandResult) : null);
  const submitDisabled = !sid || !moduleName || !inputParsed.ok || exec.isPending;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Errand exec</h1>
          <div className={styles.crumbs}>pull ad-hoc запуск одного модуля на Soul (ADR-033)</div>
        </div>
      </div>

      <section className={styles.section} aria-label="Параметры Errand">
        <div className={styles.filters}>
          <Input
            label="SID (FQDN)"
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            placeholder="host01.example.com"
            mono
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>Module</span>
            <input
              list="errand-modules"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="core.cmd.shell"
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                minWidth: 220,
              }}
            />
            <datalist id="errand-modules">
              {KNOWN_MODULES.map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>
          <Input
            label="Timeout (s)"
            type="number"
            min={1}
            max={300}
            value={timeout}
            onChange={(e) => setTimeout(Number(e.target.value) || 30)}
            mono
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>Dry-run</span>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              style={{ width: 20, height: 20 }}
              aria-label="dry_run"
            />
          </label>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={styles.metaKey}>Input (JSON-object)</span>
          <textarea
            value={inputRaw}
            onChange={(e) => setInputRaw(e.target.value)}
            rows={6}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              padding: 8,
              background: 'var(--surface)',
              border: `1px solid ${inputParsed.ok ? 'var(--border)' : 'var(--danger)'}`,
              borderRadius: 'var(--radius)',
              resize: 'vertical',
            }}
            placeholder='{"command": "uptime"}'
          />
          {!inputParsed.ok ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{inputParsed.err}</span>
          ) : null}
        </label>
        <div>
          <Button variant="primary" disabled={submitDisabled} onClick={() => exec.mutate()}>
            {exec.isPending ? 'Запускаем…' : 'Run'}
          </Button>
        </div>
        {exec.error ? (
          <div className={styles.errorBox}>
            {exec.error instanceof ApiError
              ? `Ошибка ${exec.error.status}: ${exec.error.message}`
              : String(exec.error)}
          </div>
        ) : null}
      </section>

      {errandId && !finalResult ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Async polling</h2>
          <div className={styles.meta}>
            <span className={styles.metaKey}>errand_id</span>
            <span className={styles.metaVal}>{errandId}</span>
            <span className={styles.metaKey}>status</span>
            <span><Badge tone="info">running</Badge></span>
          </div>
          {poll.error ? (
            <div className={styles.errorBox}>
              {poll.error instanceof ApiError
                ? `Ошибка ${poll.error.status}: ${poll.error.message}`
                : String(poll.error)}
            </div>
          ) : null}
        </section>
      ) : null}

      {finalResult ? (
        <section className={styles.section} aria-label="Результат">
          <h2 className={styles.sectionTitle}>Результат</h2>
          <div className={styles.meta}>
            <span className={styles.metaKey}>errand_id</span>
            <span className={styles.metaVal}>{finalResult.errand_id}</span>
            <span className={styles.metaKey}>status</span>
            <span><Badge tone={statusTone(finalResult.status)}>{finalResult.status}</Badge></span>
            <span className={styles.metaKey}>module</span>
            <span className={styles.metaVal}>{finalResult.module}</span>
            <span className={styles.metaKey}>sid</span>
            <span className={styles.metaVal}>{finalResult.sid}</span>
            {finalResult.exit_code !== undefined && finalResult.exit_code !== null ? (
              <>
                <span className={styles.metaKey}>exit_code</span>
                <span className={styles.metaVal}>{finalResult.exit_code}</span>
              </>
            ) : null}
            {finalResult.duration_ms !== undefined ? (
              <>
                <span className={styles.metaKey}>duration_ms</span>
                <span className={styles.metaVal}>{finalResult.duration_ms}</span>
              </>
            ) : null}
            {finalResult.error_message ? (
              <>
                <span className={styles.metaKey}>error</span>
                <span className={styles.metaVal}>{finalResult.error_message}</span>
              </>
            ) : null}
          </div>
          <StreamBlock label="stdout" text={finalResult.stdout} truncated={finalResult.stdout_truncated} />
          <StreamBlock label="stderr" text={finalResult.stderr} truncated={finalResult.stderr_truncated} />
        </section>
      ) : null}
    </div>
  );
}
