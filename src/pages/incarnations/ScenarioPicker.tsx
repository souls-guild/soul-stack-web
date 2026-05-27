import type { ScenariosQueryResult } from './useServiceScenarios';

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
          <option value="">— выберите сценарий —</option>
          {scenarios.items.map((s) => (
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
          placeholder="restart / add_user / converge / …"
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
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Загружаем сценарии…</span>
      ) : scenarios.unavailable ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          Каталог сценариев недоступен. Имя вводится вручную; совпадение с{' '}
          <code className="mono">scenario/&lt;name&gt;/</code> в сервисе проверит Keeper.
        </span>
      ) : scenarios.error ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{scenarios.error}</span>
      ) : (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          Из <code className="mono">GET /v1/services/&#123;name&#125;/scenarios</code>.
        </span>
      )}
    </label>
  );
}
