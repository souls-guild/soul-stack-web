import type { ReactNode } from 'react';
import { Input } from '../primitives';
import type { SecretMode } from './secretMode';
import styles from '../../pages/common.module.css';

// Контрол секрет-поля с dual-mode вводом (ADR-064): переключатель «значение | путь»
// + активный инпут. «значение» → plaintext (keeper сам кладёт в Vault); «путь» →
// vault-ref (как раньше). Ровно один режим активен → XOR структурно гарантирован.
// value-редактор по умолчанию — password-инпут; для нестрокового значения
// (credentials-объект) передаётся через renderValue.

interface Props {
  label: string;
  required?: boolean;
  mode: SecretMode;
  onModeChange: (m: SecretMode) => void;
  /** Префикс data-testid: `${testIdBase}-mode-value` / `-mode-ref` / `-value` / `-ref`. */
  testIdBase: string;
  valueModeLabel: string;
  refModeLabel: string;

  // value (plaintext) side
  value?: string;
  onValueChange?: (v: string) => void;
  valuePlaceholder?: string;
  valueHint?: string;
  /** Кастомный редактор значения (напр. key/value для credentials). Перекрывает дефолтный инпут. */
  renderValue?: (args: { testId: string }) => ReactNode;

  // ref (vault) side
  refValue: string;
  onRefChange: (v: string) => void;
  refPlaceholder?: string;
  refHint?: string;
  /** Переопределение testid ref-инпута (backward-compat с существующими тестами). */
  refTestId?: string;
  refType?: 'text' | 'password';
}

export function SecretModeField({
  label,
  required,
  mode,
  onModeChange,
  testIdBase,
  valueModeLabel,
  refModeLabel,
  value = '',
  onValueChange,
  valuePlaceholder,
  valueHint,
  renderValue,
  refValue,
  onRefChange,
  refPlaceholder,
  refHint,
  refTestId,
  refType = 'text',
}: Props) {
  const valueTestId = `${testIdBase}-value`;
  const refInputTestId = refTestId ?? `${testIdBase}-ref`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className={styles.metaKey}>{label}{required ? ' *' : ''}</span>

      <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 4 }}>
        <ModeButton
          testId={`${testIdBase}-mode-value`}
          active={mode === 'value'}
          onClick={() => onModeChange('value')}
          label={valueModeLabel}
        />
        <ModeButton
          testId={`${testIdBase}-mode-ref`}
          active={mode === 'ref'}
          onClick={() => onModeChange('ref')}
          label={refModeLabel}
        />
      </div>

      {mode === 'value' ? (
        renderValue ? (
          renderValue({ testId: valueTestId })
        ) : (
          <>
            <Input
              data-testid={valueTestId}
              type="password"
              value={value}
              onChange={(e) => onValueChange?.(e.target.value)}
              placeholder={valuePlaceholder}
              autoComplete="off"
            />
            {valueHint ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{valueHint}</span> : null}
          </>
        )
      ) : (
        <>
          <Input
            data-testid={refInputTestId}
            type={refType}
            value={refValue}
            onChange={(e) => onRefChange(e.target.value)}
            placeholder={refPlaceholder}
            autoComplete="off"
          />
          {refHint ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{refHint}</span> : null}
        </>
      )}
    </div>
  );
}

function ModeButton({ testId, active, onClick, label }: { testId: string; active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid={testId}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '6px 10px',
        borderRadius: 'var(--radius)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface)',
        color: active ? 'var(--accent)' : 'var(--text)',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
