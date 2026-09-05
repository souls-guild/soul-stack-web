import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { applyLabelAfterCreate } from '../../api/applyLabel';
import { canonicalJson } from '../../api/canonicalJson';
import { keeperApi, type Tiding, type TidingCreateRequest, type TidingUpdateRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Modal, Button, Input } from '../../components/primitives';
import { entityCaption } from '../../components/entityCaption';
import { useEventTypeCatalog } from './eventTypes';
import styles from '../common.module.css';

interface KVPair {
  key: string;
  value: string;
}

function kvFromRecord(r: Record<string, unknown> | null | undefined): KVPair[] {
  if (!r) return [];
  return Object.entries(r).map(([key, value]) => ({ key, value: String(value) }));
}

function kvToRecord(pairs: KVPair[]): Record<string, string> | null {
  const valid = pairs.filter((p) => p.key.trim());
  if (!valid.length) return null;
  return Object.fromEntries(valid.map((p) => [p.key.trim(), p.value]));
}

function KVEditor({ pairs, onChange }: { pairs: KVPair[]; onChange: (next: KVPair[]) => void }) {
  const { t } = useTranslation('notifications');
  function updateKey(i: number, k: string) {
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, key: k } : p)));
  }
  function updateVal(i: number, v: string) {
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, value: v } : p)));
  }
  function remove(i: number) {
    onChange(pairs.filter((_, idx) => idx !== i));
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Input
            value={p.key}
            onChange={(e) => updateKey(i, e.target.value)}
            placeholder="key"
            aria-label={`annotation key ${i}`}
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>=</span>
          <Input
            value={p.value}
            onChange={(e) => updateVal(i, e.target.value)}
            placeholder="value"
            aria-label={`annotation value ${i}`}
            style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
          <Button type="button" variant="ghost" onClick={() => remove(i)} aria-label={`remove annotation ${i}`} style={{ padding: '2px 6px' }}>
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
        data-testid="tiding-annotation-add"
        style={{ alignSelf: 'flex-start', fontSize: 12, padding: '2px 8px' }}
      >
        <Plus size={12} /> {t('tidingAnnotationAddBtn')}
      </Button>
    </div>
  );
}

function ProjectionEditor({ paths, onChange }: { paths: string[]; onChange: (next: string[]) => void }) {
  const { t } = useTranslation('notifications');
  function update(i: number, v: string) {
    onChange(paths.map((p, idx) => (idx === i ? v : p)));
  }
  function remove(i: number) {
    onChange(paths.filter((_, idx) => idx !== i));
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {paths.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Input
            value={p}
            onChange={(e) => update(i, e.target.value)}
            placeholder={t('tidingFieldProjectionPlaceholder')}
            aria-label={`projection path ${i}`}
            data-testid={`tiding-projection-path-${i}`}
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
          <Button type="button" variant="ghost" onClick={() => remove(i)} aria-label={`remove projection ${i}`} style={{ padding: '2px 6px' }}>
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange([...paths, ''])}
        data-testid="tiding-projection-add"
        style={{ alignSelf: 'flex-start', fontSize: 12, padding: '2px 8px' }}
      >
        <Plus size={12} /> {t('tidingProjectionAddBtn')}
      </Button>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** If provided — edit mode. */
  editing?: Tiding;
  /** Preset cadence on create (used when navigating from CadenceDetail). */
  initialCadence?: string;
}

export function TidingModal({ open, onClose, editing, initialCadence }: Props) {
  const { t } = useTranslation(['notifications', 'common']);
  const tc = (k: string) => t(`common:${k}`);
  const qc = useQueryClient();

  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  // Set when the entity was created but its caption write was refused.
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const [herald, setHerald] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [customType, setCustomType] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [incarnation, setIncarnation] = useState('');
  const [cadence, setCadence] = useState('');
  const [task, setTask] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [annotationPairs, setAnnotationPairs] = useState<KVPair[]>([]);
  const [projectionPaths, setProjectionPaths] = useState<string[]>([]);

  const heraldsQ = useQuery({
    queryKey: ['heralds.list'],
    queryFn: () => keeperApi.heralds.list({ limit: 200 }),
    enabled: open,
  });

  const eventTypeCatalog = useEventTypeCatalog();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setId(editing.id);
      setLabel(editing.label ?? '');
      setHerald(editing.herald);
      setSelectedTypes(editing.event_types ?? []);
      setOnlyFailures(editing.only_failures ?? false);
      setOnlyChanges(editing.only_changes ?? false);
      setIncarnation(editing.incarnation ?? '');
      setCadence(editing.cadence ?? '');
      setTask(editing.task ?? '');
      setEnabled(editing.enabled);
      setAnnotationPairs(kvFromRecord(editing.annotations as Record<string, unknown> | null | undefined));
      setProjectionPaths(editing.projection ?? []);
    } else {
      setId('');
      setLabel('');
      setLabelNotice(null);
      setHerald('');
      setSelectedTypes([]);
      setCustomType('');
      setOnlyFailures(false);
      setOnlyChanges(false);
      setIncarnation('');
      setCadence(initialCadence ?? '');
      setTask('');
      setEnabled(true);
      setAnnotationPairs([]);
      setProjectionPaths([]);
    }
  }, [open, editing, initialCadence]);

  const createMu = useMutation({
    // The caption travels on its own endpoint after the create: the keeper accepts
    // `label` in the create body and drops it (see applyLabelAfterCreate).
    mutationFn: async (body: TidingCreateRequest) => {
      const td = await keeperApi.tidings.create(body);
      return applyLabelAfterCreate((b) => keeperApi.tidings.setLabel(td.id, b), label);
    },
    onSuccess: (labelError) => {
      qc.invalidateQueries({ queryKey: ['tidings.list'] });
      if (labelError) {
        setLabelNotice(labelError);
        return;
      }
      onClose();
    },
  });

  // The update body the record as loaded would produce — used only to tell a
  // caption-only save from a real edit. Mirrors the shape built in handleSubmit.
  function bodyFromEditing(): TidingUpdateRequest | null {
    if (!editing) return null;
    const annotations = editing.annotations as TidingUpdateRequest['annotations'];
    const projection = editing.projection ?? [];
    return {
      herald: editing.herald,
      event_types: editing.event_types ?? [],
      only_failures: editing.only_failures ?? false,
      only_changes: editing.only_changes ?? false,
      incarnation: editing.incarnation || undefined,
      cadence: editing.cadence || undefined,
      task: editing.task || undefined,
      enabled: editing.enabled,
      ...(annotations && Object.keys(annotations).length > 0 ? { annotations } : {}),
      ...(projection.length > 0 ? { projection } : {}),
    };
  }

  const updateMu = useMutation({
    // TidingUpdateRequest replaces the rule and carries no label, so a changed
    // caption is a second request against PUT /v1/tidings/{id}/label.
    mutationFn: async (body: TidingUpdateRequest) => {
      // Skip the replace when only the caption moved: PUT replaces the rule and
      // writes a `tiding.updated` audit event. Anything this form cannot
      // round-trip compares unequal and still sends.
      if (canonicalJson(body) !== canonicalJson(bodyFromEditing())) {
        await keeperApi.tidings.update(editing!.id, body);
      }
      const next = label.trim();
      if (next !== (editing!.label ?? '')) {
        await keeperApi.tidings.setLabel(editing!.id, { label: next ? next : null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tidings.list'] });
      qc.invalidateQueries({ queryKey: ['tiding.get', editing!.id] });
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
    // If the custom-type field has non-empty text not yet added via the button — add it.
    // addCustomType shifts state through the setter, so we build the final array manually.
    const finalTypes =
      customType.trim() && !selectedTypes.includes(customType.trim())
        ? [...selectedTypes, customType.trim()]
        : selectedTypes;
    if (customType.trim()) {
      addCustomType();
    }
    const annotations = kvToRecord(annotationPairs);
    const projection = projectionPaths.filter((p) => p.trim());
    if (editing) {
      const body: TidingUpdateRequest = {
        herald,
        event_types: finalTypes,
        only_failures: onlyFailures,
        only_changes: onlyChanges,
        incarnation: incarnation || undefined,
        cadence: cadence || undefined,
        task: task || undefined,
        enabled,
        ...(annotations ? { annotations } : {}),
        ...(projection.length > 0 ? { projection } : {}),
      };
      updateMu.mutate(body);
    } else {
      const body: TidingCreateRequest = {
        id,
        herald,
        event_types: finalTypes,
        only_failures: onlyFailures,
        only_changes: onlyChanges,
        incarnation: incarnation || undefined,
        cadence: cadence || undefined,
        task: task || undefined,
        enabled,
        ...(annotations ? { annotations } : {}),
        ...(projection.length > 0 ? { projection } : {}),
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
        {editing ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('common:colId')}</span>
            <Input data-testid="tiding-id-input" value={editing.id} readOnly mono />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('notifications:tidingFieldIdImmutableHint')}
            </span>
          </label>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('common:colId')} *</span>
            <Input
              data-testid="tiding-id-input"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-run-alerts"
              required
              pattern="^[a-z0-9-]{1,63}$"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('notifications:tidingFieldIdHint')}
            </span>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('common:colLabel')}</span>
          <Input
            data-testid="tiding-label-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My run alerts"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldLabelHint')}
          </span>
        </label>

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
              <option key={h.id} value={h.id}>{entityCaption(h)}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldEventTypes')} *</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldEventTypesHint')}
          </span>
          {/* Event-types catalog from backend — toggle chips (ADR-042) */}
          <div
            data-testid="tiding-event-types-chips"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}
          >
            {eventTypeCatalog.isLoading && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('notifications:tidingEventTypesLoading')}
              </span>
            )}
            {eventTypeCatalog.allTypes.map((et) => {
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
            {/* Custom types (not from the catalog) — chips with a remove button */}
            {selectedTypes
              .filter((et) => !eventTypeCatalog.allTypes.includes(et))
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
          {/* Free-form input */}
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldTask')}</span>
          <Input
            data-testid="tiding-task-input"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="redis_conf"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldTaskHint')}
          </span>
        </label>

        {/* Annotations — static fields added to the webhook body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldAnnotations')}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldAnnotationsHint')}
          </span>
          <KVEditor pairs={annotationPairs} onChange={setAnnotationPairs} />
        </div>

        {/* Projection — allow-list of payload paths */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('notifications:tidingFieldProjection')}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('notifications:tidingFieldProjectionHint')}
          </span>
          <ProjectionEditor paths={projectionPaths} onChange={setProjectionPaths} />
        </div>

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

        {labelNotice ? (
          <div role="alert" className={styles.errorBox} data-testid="tiding-label-notice">
            {labelNotice}
          </div>
        ) : null}
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
            disabled={Boolean(labelNotice) || isPending || !herald || selectedTypes.length === 0}
          >
            {editing ? tc('save') : tc('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
