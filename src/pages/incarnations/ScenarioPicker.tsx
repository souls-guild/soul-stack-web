import { useTranslation } from 'react-i18next';
import type { ScenariosQueryResult } from './useServiceScenarios';
import { runnableScenarios } from './reservedScenarios';

// Поле выбора сценария: select при доступных scenarios, иначе text input.
// register-обработчики react-hook-form подаются полями onChange/onBlur/value/name.
interface Props {
  scenarios: ScenariosQueryResult;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name: string;
  error?: string;
  disabled?: boolean;
}

export function ScenarioField({
  scenarios,
  value,
  onChange,
  onBlur,
  name,
  error,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const useDropdown = !scenarios.unavailable && scenarios.items.length > 0;

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Scenario</span>
      {useDropdown ? (
        <select
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled || scenarios.loading}
          aria-invalid={error ? 'true' : undefined}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            background: 'var(--surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
          }}
        >
          <option value="">{t('incarnations:selectScenario')}</option>
          {runnableScenarios(scenarios.items).map((s) => (
            <option key={s.name} value={s.name} title={s.description ?? ''}>
              {s.name}
              {s.description ? ` — ${s.description}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={t('incarnations:scenarioPlaceholder')}
          aria-invalid={error ? 'true' : undefined}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            background: 'var(--surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
          }}
        />
      )}
      {error ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>
      ) : scenarios.loading ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t('incarnations:scenarioLoading')}</span>
      ) : scenarios.unavailable ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          {t('incarnations:scenarioUnavailable')}
        </span>
      ) : scenarios.error ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{scenarios.error}</span>
      ) : (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          {t('incarnations:scenarioSource')}
        </span>
      )}
    </label>
  );
}
