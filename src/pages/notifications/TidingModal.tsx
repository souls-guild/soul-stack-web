import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { keeperApi, type Tiding, type TidingCreateRequest, type TidingUpdateRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Modal, Button, Input } from '../../components/primitives';
import { KNOWN_EVENT_TYPE_AREAS } from './eventTypes';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Если передан — режим редактирования. */
  editing?: Tiding;
}

export function TidingModal({ open, onClose, editing }: Props) {
  const { t } = useTranslation(['notifications', 'common']);
  const tc = (k: string) => t(`common:${k}`);
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [herald, setHerald] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [customType, setCustomType] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [incarnation, setIncarnation] = useState('');
  const [cadence, setCadence] = useState('');
  const [enabled, setEnabled] = useState(true);

  const heraldsQ = useQuery({
    queryKey: ['heralds.list'],
    queryFn: () => keeperApi.heralds.list({ limit: 200 }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setHerald(editing.herald);
      setSelectedTypes(editing.event_types ?? []);
      setOnlyFailures(editing.only_failures ?? false);
      setOnlyChanges(editing.only_changes ?? false);
      setIncarnation(editing.incarnation ?? '');
      setCadence(editing.cadence ?? '');
      setEnabled(editing.enabled);
    } else {
      setName('');
      setHerald('');
      setSelectedTypes([]);
      setCustomType('');
      setOnlyFailures(false);
      setOnlyChanges(false);
      setIncarnation('');
      setCadence('');
      setEnabled(true);
    }
  }, [open, editing]);

  const createMu = useMutation({
    mutationFn: (body: TidingCreateRequest) => keeperApi.tidings.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tidings.list'] });
      onClose();
    },
  });

  const updateMu = useMutation({
    mutationFn: (body: TidingUpdateRequest) => keeperApi.tidings.update(editing!.name, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tidings.list'] });
      qc.invalidateQueries({ queryKey: ['tiding.get', editing!.name] });
      onClose();
    },
  });

  const mu = editing ? updateMu : createMu;

  function toggleType(et: string) {
    setSelectedTypes((prev) =>
      prev.includes(et) ? prev.filter((x) => x !== et) : [...prev, et],
    );
  }

  function addCustomType() {
    const val = customType.trim();
    if (!val || selectedTypes.includes(val)) return;
    setSelectedTypes((prev) => [...prev, val]);
    setCustomType('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Если в поле кастомного типа есть непустой текст, не добавленный кнопкой — добавить его.
    // addCustomType сдвигает состояние через setter, поэтому собираем итоговый массив вручную.
    const finalTypes =
      customType.trim() && !selectedTypes.includes(customType.trim())
        ? [...selectedTypes, customType.trim()]
        : selectedTypes;
    if (customType.trim()) {
      addCustomType();
    }
    if (editing) {
      const body: TidingUpdateRequest = {
        herald,
        event_types: finalTypes,
        only_failures: onlyFailures,
        only_changes: onlyChanges,
        incarnation: incarnation || null,
        cadence: cadence || null,
        enabled,
      };
      updateMu.mutate(body);
    } else {
      const body: TidingCreateRequest = {
        name,
        herald,
        event_types: finalTypes,
        only_failures: onlyFailures,
        only_changes: onlyChanges,
        incarnation: incarnation || null,
        cadence: cadence || null,
        enabled,
      };
      createMu.mutate(body);
    }
  }

  const isPending = mu.isPending;
  const error = mu.error;
  const title = editing ? t('notifications:tidingEditTitle') : t('notifications:tidingCreateTitle');
  const heraldItems = heraldsQ.data?.items ?? [];

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!editing && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('notifications:tidingFieldName')} *</span>
            <Input
              data-testid="tiding-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-run-alerts"
              required
              pattern="^[a-z0-9-]{1,63}$"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('notifications:tidingFieldNameHint')}
            </span>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldHerald')} *</span>
          <select
            data-testid="tiding-herald-select"
            value={herald}
            onChange={(e) => setHerald(e.target.value)}
            required
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <option value="">{t('notifications:tidingFieldHeraldPlaceholder')}</option>
            {heraldItems.map((h) => (
              <option key={h.name} value={h.name}>{h.name}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldEventTypes')} *</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldEventTypesHint')}
          </span>
          {/* Известные области — чипы-переключатели */}
          <div
            data-testid="tiding-event-types-chips"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}
          >
            {KNOWN_EVENT_TYPE_AREAS.map((et) => {
              const selected = selectedTypes.includes(et);
              return (
                <button
                  key={et}
                  type="button"
                  data-testid={`event-type-chip-${et}`}
                  onClick={() => toggleType(et)}
                  aria-pressed={selected}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 'var(--radius-pill)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    background: selected ? 'var(--accent)' : 'var(--surface)',
                    color: selected ? '#fff' : 'var(--text)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                >
                  {et}
                </button>
              );
            })}
            {/* Пользовательские типы — чипы с кнопкой удалить */}
            {selectedTypes
              .filter((et) => !(KNOWN_EVENT_TYPE_AREAS as readonly string[]).includes(et))
              .map((et) => (
                <span
                  key={et}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 6px 3px 10px',
                    borderRadius: 'var(--radius-pill)',
                    border: '1px solid var(--accent)',
                    background: 'var(--accent)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                >
                  {et}
                  <button
                    type="button"
                    aria-label={`remove event type ${et}`}
                    onClick={() => toggleType(et)}
                    style={{
                      border: 0,
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#fff',
                      padding: 0,
                      display: 'inline-flex',
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
          </div>
          {/* Свободный ввод */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <Input
              data-testid="tiding-custom-event-type-input"
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              placeholder="my_domain.event_name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomType();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              data-testid="tiding-add-custom-type-btn"
              onClick={addCustomType}
              disabled={!customType.trim()}
            >
              {t('notifications:tidingEventTypesAddBtn')}
            </Button>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid="tiding-only-failures"
            checked={onlyFailures}
            onChange={(e) => setOnlyFailures(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('notifications:tidingFieldOnlyFailures')}
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid="tiding-only-changes"
            checked={onlyChanges}
            onChange={(e) => setOnlyChanges(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('notifications:tidingFieldOnlyChanges')}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldIncarnation')}</span>
          <Input
            data-testid="tiding-incarnation-input"
            value={incarnation}
            onChange={(e) => setIncarnation(e.target.value)}
            placeholder="my-service"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldIncarnationHint')}
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldCadence')}</span>
          <Input
            data-testid="tiding-cadence-input"
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            placeholder="redis-hourly"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldCadenceHint')}
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid="tiding-enabled-checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('notifications:tidingFieldEnabled')}
        </label>

        {error ? (
          <div role="alert" className={styles.errorBox}>
            {error instanceof ApiError
              ? String(error.status) + ': ' + error.message
              : String(error)}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={isPending}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isPending || !herald || selectedTypes.length === 0}
          >
            {editing ? tc('save') : tc('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
