import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type Herald, type HeraldCreateRequest, type HeraldUpdateRequest, type HeraldTypeFieldSpec } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Modal, Button, Input } from '../../components/primitives';
import { SecretModeField } from '../../components/input/SecretModeField';
import { pickSecretField, plaintextDisabledMessage, type SecretMode } from '../../components/input/secretMode';
import { useHeraldTypeCatalog } from './heraldTypes';
import styles from '../common.module.css';

// Состояние одного секрет-поля канала (config <base> XOR <base>_ref, ADR-064).
interface SecretFieldState {
  mode: SecretMode;
  value: string; // plaintext (не сохраняется/не возвращается сервером)
  ref: string; // vault-ref
}

const EMPTY_SECRET: SecretFieldState = { mode: 'ref', value: '', ref: '' };

// base-имя секрет-поля: bot_token_ref → bot_token (см. herald/secret.go).
function secretBase(fieldName: string): string {
  return fieldName.replace(/_ref$/, '');
}

// Типовой пример значения секрет-поля (placeholder, чисто UX — каталог примеров
// не отдаёт). Пусто → placeholder не показываем.
function secretValueExample(base: string): string {
  switch (base) {
    case 'bot_token':
      return '123456789:AAE-ExampleTelegramBotToken';
    case 'webhook_url':
      return 'https://hooks.example.com/services/T000/B000/xxxx';
    case 'header_secret':
      return 'Bearer s3cr3t-token';
    case 'password':
      return 'smtp-app-password';
    default:
      return '';
  }
}

// Начальное состояние секрет-полей типа из существующего config (edit): в config
// хранится только *_ref (plaintext сервер стирает) → режим ref, value пуст.
function secretFieldsFromConfig(fields: HeraldTypeFieldSpec[], config: Record<string, unknown> | null | undefined): Record<string, SecretFieldState> {
  const cfg = config ?? {};
  const out: Record<string, SecretFieldState> = {};
  for (const f of fields) {
    if (!f.secret) continue;
    const ref = typeof cfg[f.name] === 'string' ? (cfg[f.name] as string) : '';
    out[f.name] = { mode: 'ref', value: '', ref };
  }
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Если передан — режим редактирования, иначе создание. */
  editing?: Herald;
}

/**
 * Парсит строку "Key: Value\nKey2: Value2" в объект. Строки без ':' игнорируются.
 * Общий формат для kind=map (headers и т.п.).
 */
function parseKV(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) result[k] = v;
  }
  return result;
}

function serialiseKV(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  return Object.entries(v as Record<string, unknown>)
    .map(([k, val]) => `${k}: ${String(val)}`)
    .join('\n');
}

/** Парсит построчный список (kind=list/list_string). Пустые строки отбрасываются. */
function parseLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function serialiseLines(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v.map(String).join('\n');
}

/** Дефолтное raw-значение конфиг-поля по его Kind (для controlled-инпутов). */
function defaultRawValue(kind: string): unknown {
  switch (kind) {
    case 'bool':
      return false;
    case 'map':
    case 'list':
    case 'list_string':
      return '';
    default:
      return '';
  }
}

/** Строит начальные raw-значения формы из существующего config (режим редактирования). */
function rawValuesFromConfig(fields: HeraldTypeFieldSpec[], config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const cfg = config ?? {};
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = cfg[f.name];
    switch (f.kind) {
      case 'bool':
        out[f.name] = Boolean(raw);
        break;
      case 'map':
        out[f.name] = serialiseKV(raw);
        break;
      case 'list':
      case 'list_string':
        out[f.name] = serialiseLines(raw);
        break;
      case 'int':
        out[f.name] = raw === undefined || raw === null ? '' : String(raw);
        break;
      default:
        out[f.name] = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw);
    }
  }
  return out;
}

/** Собирает config-объект для отправки backend-у из raw form-значений по каталогу полей. */
function configFromRawValues(fields: HeraldTypeFieldSpec[], raw: Record<string, unknown>): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const f of fields) {
    const v = raw[f.name];
    switch (f.kind) {
      case 'bool':
        if (v) cfg[f.name] = true;
        break;
      case 'map': {
        const parsed = parseKV(String(v ?? ''));
        if (Object.keys(parsed).length > 0) cfg[f.name] = parsed;
        break;
      }
      case 'list':
      case 'list_string': {
        const parsed = parseLines(String(v ?? ''));
        if (parsed.length > 0) cfg[f.name] = parsed;
        break;
      }
      case 'int': {
        const s = String(v ?? '').trim();
        if (s !== '') {
          const n = Number(s);
          if (!Number.isNaN(n)) cfg[f.name] = n;
        }
        break;
      }
      default: {
        const s = String(v ?? '').trim();
        if (s !== '') cfg[f.name] = s;
      }
    }
  }
  return cfg;
}

export function HeraldModal({ open, onClose, editing }: Props) {
  const { t } = useTranslation(['notifications', 'common', 'forms']);
  const tc = (k: string) => t(`common:${k}`);
  const qc = useQueryClient();
  const typeCatalog = useHeraldTypeCatalog();

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [secretFields, setSecretFields] = useState<Record<string, SecretFieldState>>({});
  // top-level webhook signing secret (dual-mode secret XOR secret_ref, ADR-064).
  const [secretMode, setSecretMode] = useState<SecretMode>('ref');
  const [secretValue, setSecretValue] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [enabled, setEnabled] = useState(true);

  const fields = typeCatalog.fieldsByType[type] ?? [];

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setSecretMode('ref');
      setSecretValue('');
      setSecretRef(editing.secret_ref ?? '');
      setEnabled(editing.enabled);
      // config зависит от полей каталога типа editing.type — если каталог ещё
      // не загрузился (isLoading), rawValuesFromConfig([]) даёт {} и второй
      // useEffect ниже перезаполнит значения, когда каталог придёт.
      const typeFields = typeCatalog.fieldsByType[editing.type] ?? [];
      setFieldValues(rawValuesFromConfig(typeFields, editing.config as Record<string, unknown> | null | undefined));
      setSecretFields(secretFieldsFromConfig(typeFields, editing.config as Record<string, unknown> | null | undefined));
    } else {
      setName('');
      setType('');
      setSecretMode('ref');
      setSecretValue('');
      setSecretRef('');
      setEnabled(true);
      setFieldValues({});
      setSecretFields({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typeCatalog намеренно не в deps: обрабатывается след. effect-ом на isLoading
  }, [open, editing]);

  // Каталог мог подгрузиться ПОСЛЕ открытия модалки в editing-режиме (форма
  // уже смонтирована с пустыми fields) — как только isLoading перешёл в false,
  // перезаполняем values по актуальному дескриптору полей editing.type.
  useEffect(() => {
    if (!open || !editing || typeCatalog.isLoading) return;
    const typeFields = typeCatalog.fieldsByType[editing.type];
    if (!typeFields || typeFields.length === 0) return;
    setFieldValues(rawValuesFromConfig(typeFields, editing.config as Record<string, unknown> | null | undefined));
    setSecretFields(secretFieldsFromConfig(typeFields, editing.config as Record<string, unknown> | null | undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typeCatalog.fieldsByType — нестабильная ссылка, триггер только по isLoading
  }, [open, editing, typeCatalog.isLoading]);

  // Смена типа (не editing-инициализация) — сбрасывает значения полей на дефолт нового типа.
  function handleTypeChange(nextType: string) {
    setType(nextType);
    const nextFields = typeCatalog.fieldsByType[nextType] ?? [];
    const defaults: Record<string, unknown> = {};
    const secretDefaults: Record<string, SecretFieldState> = {};
    for (const f of nextFields) {
      if (f.secret) secretDefaults[f.name] = { ...EMPTY_SECRET };
      else defaults[f.name] = defaultRawValue(f.kind);
    }
    setFieldValues(defaults);
    setSecretFields(secretDefaults);
    // top-level signing secret сбрасывается при смене типа.
    setSecretMode('ref');
    setSecretValue('');
    setSecretRef('');
  }

  function setFieldValue(fieldName: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  function updateSecretField(fieldName: string, patch: Partial<SecretFieldState>) {
    setSecretFields((prev) => ({ ...prev, [fieldName]: { ...(prev[fieldName] ?? EMPTY_SECRET), ...patch } }));
  }

  const createMu = useMutation({
    mutationFn: (body: HeraldCreateRequest) => keeperApi.heralds.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['heralds.list'] });
      onClose();
    },
  });

  const updateMu = useMutation({
    mutationFn: (body: HeraldUpdateRequest) => keeperApi.heralds.update(editing!.name, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['heralds.list'] });
      qc.invalidateQueries({ queryKey: ['herald.get', editing!.name] });
      onClose();
    },
  });

  const mu = editing ? updateMu : createMu;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // config в OpenAPI-схеме Herald — opaque object (type: object без properties).
    // openapi-typescript генерирует Record<string, unknown>; приводим через as-cast.
    const cfg = configFromRawValues(fields.filter((f) => !f.secret), fieldValues) as Record<string, unknown>;
    // Config-секреты канала (dual-mode <base> XOR <base>_ref, ADR-064): шлём поле
    // активного режима — значение (plaintext) в <base> ИЛИ vault-ref в <base>_ref.
    for (const f of fields) {
      if (!f.secret) continue;
      const st = secretFields[f.name] ?? EMPTY_SECRET;
      const picked = pickSecretField(st.mode, st.value, st.ref);
      if (!picked) continue;
      if (picked.kind === 'value') cfg[secretBase(f.name)] = picked.value;
      else cfg[f.name] = picked.value;
    }
    // top-level webhook signing secret (dual-mode secret XOR secret_ref) — только
    // для secret_required-типов (webhook); иначе оба поля опущены.
    let topSecret: string | undefined;
    let topSecretRef: string | undefined;
    if (typeCatalog.secretRequiredByType[type]) {
      const picked = pickSecretField(secretMode, secretValue, secretRef);
      if (picked?.kind === 'value') topSecret = picked.value;
      else if (picked?.kind === 'ref') topSecretRef = picked.value;
    }
    const configOut = cfg as HeraldCreateRequest['config'];
    if (editing) {
      const body: HeraldUpdateRequest = {
        type: type as HeraldUpdateRequest['type'],
        config: configOut,
        secret: topSecret,
        secret_ref: topSecretRef,
        enabled,
      };
      updateMu.mutate(body);
    } else {
      const body: HeraldCreateRequest = {
        name,
        type: type as HeraldCreateRequest['type'],
        config: configOut,
        secret: topSecret,
        secret_ref: topSecretRef,
        enabled,
      };
      createMu.mutate(body);
    }
  }

  const isPending = mu.isPending;
  const error = mu.error;
  const title = editing ? t('notifications:heraldEditTitle') : t('notifications:heraldCreateTitle');

  // Обязательные поля типа (кроме уже заполненных) не заполнены → submit disabled.
  const missingRequired = fields.some((f) => {
    if (!f.required) return false;
    if (f.secret) {
      // dual-mode: заполнено ⟺ активный режим даёт непустое значение (XOR).
      const st = secretFields[f.name];
      return !st || pickSecretField(st.mode, st.value, st.ref) === null;
    }
    const v = fieldValues[f.name];
    if (f.kind === 'bool') return false;
    return String(v ?? '').trim() === '';
  });
  const canSubmit = Boolean(type) && !missingRequired;

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!editing && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('notifications:heraldFieldName')} *</span>
            <Input
              data-testid="herald-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-webhook"
              required
              pattern="^[a-z0-9-]{1,63}$"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('notifications:heraldFieldNameHint')}</span>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:heraldFieldType')} *</span>
          <select
            data-testid="herald-type-select"
            value={type}
            onChange={(e) => handleTypeChange(e.target.value)}
            required
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <option value="">{t('forms:selectPlaceholder')}</option>
            {typeCatalog.types.map((entry) => (
              <option key={entry.type} value={entry.type}>{entry.type}</option>
            ))}
          </select>
          {typeCatalog.isLoading && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }} data-testid="herald-type-catalog-loading">
              {t('notifications:heraldTypeCatalogLoading')}
            </span>
          )}
          {typeCatalog.isError && (
            <span role="alert" style={{ fontSize: 11, color: 'var(--danger)' }} data-testid="herald-type-catalog-error">
              {t('notifications:heraldTypeCatalogError')}
            </span>
          )}
        </label>

        {/* Динамические config-поля per-type (ADR-042 no-hardcode: каталог GET /v1/herald-types) */}
        {type && (
          <div data-testid="herald-dynamic-fields" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map((f) =>
              f.secret ? (
                <HeraldSecretFieldControl
                  key={f.name}
                  field={f}
                  state={secretFields[f.name] ?? EMPTY_SECRET}
                  onMode={(m) => updateSecretField(f.name, { mode: m })}
                  onValue={(v) => updateSecretField(f.name, { value: v })}
                  onRef={(v) => updateSecretField(f.name, { ref: v })}
                />
              ) : (
                <HeraldFieldControl
                  key={f.name}
                  field={f}
                  value={fieldValues[f.name]}
                  onChange={(v) => setFieldValue(f.name, v)}
                />
              ),
            )}
          </div>
        )}

        {type && typeCatalog.secretRequiredByType[type] && (
          <SecretModeField
            label={t('notifications:heraldFieldSecret')}
            mode={secretMode}
            onModeChange={setSecretMode}
            testIdBase="herald-secret"
            valueModeLabel={t('notifications:secretModeValue')}
            refModeLabel={t('notifications:secretModeRef')}
            value={secretValue}
            onValueChange={setSecretValue}
            valuePlaceholder="s3cr3t-signing-token"
            valueHint={t('notifications:heraldFieldSecretValueHint')}
            refValue={secretRef}
            onRefChange={setSecretRef}
            refTestId="herald-secret-ref-input"
            refType="text"
            refPlaceholder="vault:secret/my-webhook-token"
            refHint={t('notifications:heraldFieldSecretRefHint')}
          />
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid="herald-enabled-checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('notifications:heraldFieldEnabled')}
        </label>

        {error ? (
          <div role="alert" className={styles.errorBox} data-testid="herald-form-error">
            {plaintextDisabledMessage(error) ??
              (error instanceof ApiError
                ? t('errors:generic', { status: error.status, detail: error.detail || error.message })
                : String(error))}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={isPending}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={isPending || !canSubmit}>
            {editing ? tc('save') : tc('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Рендерит один config-контрол по HeraldFieldSpec.Kind (ADR-042 no-hardcode:
 * маппинг FieldKind→UI-контрол, набор полей — из backend-каталога, не хардкод).
 * kind=enum: опции — из field.enum_values (backend HeraldFieldSpec.EnumValues).
 */
function HeraldFieldControl({
  field,
  value,
  onChange,
}: {
  field: HeraldTypeFieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation(['notifications', 'forms']);
  const testId = `herald-field-${field.name}`;
  const labelSuffix = field.required ? ' *' : ` (${t('forms:optional')})`;

  if (field.kind === 'bool') {
    // http_allowed/allow_private — SSRF-opt-out-флаги (herald.channel.go
    // httpDelivery), заводятся по имени поля (не по каталогу — каталог не
    // несёт признака "security-sensitive"): показываем предупреждение при
    // включении, как в прежней webhook-only форме.
    const isSsrfOptOut = field.name === 'http_allowed' || field.name === 'allow_private';
    return (
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid={testId}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {field.label}
        </label>
        {isSsrfOptOut && Boolean(value) && (
          <div
            role="alert"
            data-testid={`${testId}-warn`}
            style={{
              padding: '6px 10px',
              marginTop: 6,
              borderRadius: 'var(--radius)',
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              border: '1px solid var(--danger)',
              fontSize: 12,
              color: 'var(--danger)',
            }}
          >
            {field.name === 'http_allowed' ? t('notifications:heraldFieldHttpAllowedWarn') : t('notifications:heraldFieldAllowPrivateWarn')}
          </div>
        )}
      </div>
    );
  }

  if (field.kind === 'map') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className={styles.metaKey}>{field.label}{labelSuffix}</span>
        <textarea
          data-testid={testId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Authorization: Bearer token"
          rows={3}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            resize: 'vertical',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('notifications:heraldFieldKindMapHint')}</span>
      </label>
    );
  }

  if (field.kind === 'list' || field.kind === 'list_string') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className={styles.metaKey}>{field.label}{labelSuffix}</span>
        <textarea
          data-testid={testId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            resize: 'vertical',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('notifications:heraldFieldKindListHint')}</span>
      </label>
    );
  }

  if (field.kind === 'vault_ref') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className={styles.metaKey}>{field.label}{labelSuffix}</span>
        <Input
          data-testid={testId}
          type="password"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="vault:secret/my-token"
          required={field.required}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('notifications:heraldFieldKindVaultRefHint')}</span>
      </label>
    );
  }

  if (field.kind === 'enum') {
    // Каталог отдаёт EnumValues per-field (backend HeraldFieldSpec.EnumValues,
    // ADR-042 no-hardcode) — рендерим select. Пустая строка "" в enumValues —
    // явная "не задано"/дефолт-опция типа (напр. parse_mode="" = plain text).
    // Если каталог для этого поля EnumValues не отдал (пусто/absent) — fallback
    // на текстовый ввод, чтобы select без вариантов не блокировал форму.
    const enumValues = field.enum_values ?? [];
    if (enumValues.length === 0) {
      return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{field.label}{labelSuffix}</span>
          <Input
            data-testid={testId}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        </label>
      );
    }
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className={styles.metaKey}>{field.label}{labelSuffix}</span>
        <select
          data-testid={testId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          {enumValues.map((ev) => (
            <option key={ev} value={ev}>
              {ev === '' ? t('notifications:heraldFieldKindEnumDefaultOption') : ev}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const inputType = field.kind === 'url' ? 'url' : field.kind === 'int' ? 'number' : 'text';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className={styles.metaKey}>{field.label}{labelSuffix}</span>
      <Input
        data-testid={testId}
        type={inputType}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
      />
    </label>
  );
}

/**
 * Секрет-поле канала с dual-mode вводом (ADR-064): значение (plaintext) XOR путь
 * (vault-ref). base-имя (bot_token_ref → bot_token) — plaintext-вариант в config;
 * *_ref — vault-путь. ref-инпут сохраняет testid herald-field-<name> (совместимость).
 */
function HeraldSecretFieldControl({
  field,
  state,
  onMode,
  onValue,
  onRef,
}: {
  field: HeraldTypeFieldSpec;
  state: SecretFieldState;
  onMode: (m: SecretMode) => void;
  onValue: (v: string) => void;
  onRef: (v: string) => void;
}) {
  const { t } = useTranslation(['notifications', 'forms']);
  const base = secretBase(field.name);
  return (
    <SecretModeField
      label={field.label}
      required={field.required}
      mode={state.mode}
      onModeChange={onMode}
      testIdBase={`herald-secret-${base}`}
      valueModeLabel={t('notifications:secretModeValue')}
      refModeLabel={t('notifications:secretModeRef')}
      value={state.value}
      onValueChange={onValue}
      valuePlaceholder={secretValueExample(base) || undefined}
      valueHint={t('notifications:heraldSecretConfigValueHint')}
      refValue={state.ref}
      onRefChange={onRef}
      refTestId={`herald-field-${field.name}`}
      refType="password"
      refPlaceholder="vault:secret/..."
      refHint={t('notifications:heraldFieldKindVaultRefHint')}
    />
  );
}
