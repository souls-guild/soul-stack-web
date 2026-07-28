import { useTranslation } from 'react-i18next';

// Raw-string fallback for a scope the builder couldn't parse (NIM-128 graceful
// degradation): the operator still edits the expression verbatim, and one click
// resets to the builder.
export function RawScopeFallback({
  text,
  onChange,
  onReset,
  ariaLabel,
}: {
  text: string;
  onChange: (text: string) => void;
  onReset: () => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        marginTop: 8,
        padding: '12px 14px',
        borderRadius: 'var(--radius)',
        border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
        background: 'color-mix(in srgb, var(--warning) 7%, var(--surface))',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {t('admin:rbacScopeRawParseFail')}
      </div>
      <textarea
        rows={2}
        value={text}
        spellCheck={false}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: 8,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          resize: 'vertical',
        }}
      />
      <button
        type="button"
        onClick={onReset}
        style={{
          marginTop: 8,
          fontSize: 12,
          padding: '4px 10px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        {t('admin:rbacScopeResetBuilder')}
      </button>
    </div>
  );
}
