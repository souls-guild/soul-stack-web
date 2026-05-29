import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type Choir, type Voice } from '../../api/keeper';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import styles from '../common.module.css';

// ChoirsTab — управление топологией (Choir/Voice) инкарнации (ADR-044).
//
// Choir — именованная партия хостов внутри инкарнации.
// Voice — членство SID в Choir-е (PK: incarnation_name + choir_name + sid).

// 404/501 — choir-подсистема недоступна (старый Keeper или ChoirDB не примонтирован).
// Прочие ошибки — настоящий hard error.
function isChoirsDegraded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

const CHOIR_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const ROLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

interface Props {
  incarnationName: string;
}

// --- Create choir modal ---

interface CreateChoirModalProps {
  open: boolean;
  incarnationName: string;
  onClose: () => void;
}

function CreateChoirModal({ open, incarnationName, onClose }: CreateChoirModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [choirName, setChoirName] = useState('');
  const [description, setDescription] = useState('');
  const [minSize, setMinSize] = useState('');
  const [maxSize, setMaxSize] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () =>
      keeperApi.choirs.create(incarnationName, {
        choir_name: choirName.trim(),
        description: description.trim() || null,
        min_size: minSize !== '' ? parseInt(minSize, 10) : null,
        max_size: maxSize !== '' ? parseInt(maxSize, 10) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incarnation-choirs', incarnationName] });
      close();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFormError(t('errors:generic', { status: err.status, detail: err.message }));
      } else {
        setFormError(String(err));
      }
    },
  });

  function close() {
    if (mu.isPending) return;
    setChoirName('');
    setDescription('');
    setMinSize('');
    setMaxSize('');
    setFormError(null);
    onClose();
  }

  function submit() {
    setFormError(null);
    const name = choirName.trim();
    if (!name) {
      setFormError(t('incarnations:choirNameRequired'));
      return;
    }
    if (!CHOIR_NAME_PATTERN.test(name)) {
      setFormError(t('incarnations:choirNamePattern'));
      return;
    }
    const min = minSize !== '' ? parseInt(minSize, 10) : null;
    const max = maxSize !== '' ? parseInt(maxSize, 10) : null;
    if (min !== null && min <= 0) {
      setFormError(t('incarnations:choirMinSizePositive'));
      return;
    }
    if (max !== null && max <= 0) {
      setFormError(t('incarnations:choirMaxSizePositive'));
      return;
    }
    if (min !== null && max !== null && max < min) {
      setFormError(t('incarnations:choirMaxLtMin'));
      return;
    }
    mu.mutate();
  }

  return (
    <Modal
      open={open}
      title={t('forms:createChoirTitle', { name: incarnationName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={mu.isPending}
            data-testid="create-choir-submit"
          >
            {mu.isPending ? t('creating') : t('create')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <label style={fieldWrapStyle}>
          <span style={labelStyle}>
            {t('incarnations:choirNameLabel')} <span style={{ color: 'var(--danger)' }}>*</span>
          </span>
          <input
            type="text"
            value={choirName}
            onChange={(e) => setChoirName(e.target.value)}
            placeholder={t('incarnations:choirNamePlaceholder')}
            spellCheck={false}
            style={inputStyle}
            data-testid="choir-name-input"
          />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {t('incarnations:choirNameHint')}
          </span>
        </label>

        <label style={fieldWrapStyle}>
          <span style={labelStyle}>{t('incarnations:choirDescriptionLabel')}</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('incarnations:choirDescriptionPlaceholder')}
            style={inputStyle}
            data-testid="choir-description-input"
          />
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{t('incarnations:choirMinSize')}</span>
            <input
              type="number"
              min={1}
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              placeholder="—"
              style={inputStyle}
              data-testid="choir-min-size-input"
            />
          </label>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{t('incarnations:choirMaxSize')}</span>
            <input
              type="number"
              min={1}
              value={maxSize}
              onChange={(e) => setMaxSize(e.target.value)}
              placeholder="—"
              style={inputStyle}
              data-testid="choir-max-size-input"
            />
          </label>
        </div>

        {formError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{formError}</div> : null}
      </form>
    </Modal>
  );
}

// --- Delete choir confirm modal ---

interface DeleteChoirModalProps {
  choir: Choir | null;
  incarnationName: string;
  onClose: () => void;
}

function DeleteChoirModal({ choir, incarnationName, onClose }: DeleteChoirModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => keeperApi.choirs.delete(incarnationName, choir!.choir_name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incarnation-choirs', incarnationName] });
      close();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(t('errors:generic', { status: err.status, detail: err.message }));
      } else {
        setError(String(err));
      }
    },
  });

  function close() {
    if (mu.isPending) return;
    setConfirmed(false);
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={choir !== null}
      title={t('forms:deleteChoirTitle', { choir: choir?.choir_name ?? '' })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => { if (confirmed) mu.mutate(); }}
            disabled={mu.isPending || !confirmed}
            data-testid="delete-choir-confirm"
          >
            {mu.isPending ? t('deleting') : t('delete')}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        {t('incarnations:deleteChoirDesc', { choir: choir?.choir_name ?? '' })}
      </p>
      <div className={styles.errorBox} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>{t('incarnations:deleteChoirWarningTitle')}</strong>{' '}
        {t('incarnations:deleteChoirWarningBody', { choir: choir?.choir_name ?? '' })}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          aria-label={t('incarnations:deleteChoirConfirmAria')}
          data-testid="delete-choir-checkbox"
        />
        <span>{t('incarnations:deleteChoirConfirmLabel')}</span>
      </label>
      {error ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}

// --- Add voice modal ---

interface AddVoiceModalProps {
  open: boolean;
  incarnationName: string;
  choirName: string;
  existingVoiceSids: string[];
  onClose: () => void;
}

function prettyVoiceError(err: unknown, incarnationName: string): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 422) return t('incarnations:voiceNotMemberError', { name: incarnationName });
    if (err.status === 404) return t('incarnations:incarnationNotFound');
    return t('errors:generic', { status: err.status, detail: err.message });
  }
  return String(err);
}

function AddVoiceModal({ open, incarnationName, choirName, existingVoiceSids, onClose }: AddVoiceModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sid, setSid] = useState('');
  const [role, setRole] = useState('');
  const [position, setPosition] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Хосты инкарнации — список souls с coven=incarnationName (аналогично HostsTab).
  const souls = useQuery({
    queryKey: ['incarnation-souls', incarnationName],
    queryFn: () => keeperApi.souls.list({ coven: [incarnationName], limit: 200 }),
    enabled: open,
  });

  const existing = new Set(existingVoiceSids);
  const candidates = (souls.data?.items ?? []).filter((s) => !existing.has(s.sid));

  const mu = useMutation({
    mutationFn: () =>
      keeperApi.choirs.addVoice(incarnationName, choirName, {
        sid,
        role: role.trim() || null,
        position: position !== '' ? parseInt(position, 10) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['choir-voices', incarnationName, choirName] });
      close();
    },
    onError: (err) => setFormError(prettyVoiceError(err, incarnationName)),
  });

  function close() {
    if (mu.isPending) return;
    setSid('');
    setRole('');
    setPosition('');
    setFormError(null);
    onClose();
  }

  function submit() {
    setFormError(null);
    if (!sid) {
      setFormError(t('errors:selectHostSid'));
      return;
    }
    const r = role.trim();
    if (r && (!ROLE_PATTERN.test(r) || r.length > 63)) {
      setFormError(t('incarnations:roleKebab'));
      return;
    }
    const pos = position !== '' ? parseInt(position, 10) : null;
    if (pos !== null && pos < 0) {
      setFormError(t('incarnations:voicePositionNonNeg'));
      return;
    }
    mu.mutate();
  }

  return (
    <Modal
      open={open}
      title={t('forms:addVoiceTitle', { choir: choirName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={mu.isPending}
            data-testid="add-voice-submit"
          >
            {mu.isPending ? t('adding') : t('add')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <label style={fieldWrapStyle}>
          <span style={labelStyle}>SID <span style={{ color: 'var(--danger)' }}>*</span></span>
          {souls.isLoading ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('incarnations:soulsLoading')}</span>
          ) : (
            <select
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              aria-label={t('incarnations:sidHostAria')}
              style={selectStyle}
              data-testid="voice-sid-select"
            >
              <option value="">{t('incarnations:selectSid')}</option>
              {candidates.map((s) => (
                <option key={s.sid} value={s.sid}>
                  {s.sid}{s.status ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
          )}
          {souls.data && candidates.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('incarnations:allSoulsAreVoices')}
            </span>
          ) : null}
        </label>

        <label style={fieldWrapStyle}>
          <span style={labelStyle}>{t('incarnations:roleOptional')}</span>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t('incarnations:rolePlaceholder')}
            spellCheck={false}
            style={inputStyle}
            data-testid="voice-role-input"
          />
        </label>

        <label style={fieldWrapStyle}>
          <span style={labelStyle}>{t('incarnations:voicePositionLabel')}</span>
          <input
            type="number"
            min={0}
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="—"
            style={inputStyle}
            data-testid="voice-position-input"
          />
        </label>

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '12px 0 0' }}>
          {t('incarnations:addVoiceHint')}
        </p>

        {formError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{formError}</div> : null}
      </form>
    </Modal>
  );
}

// --- Voices inline table ---

interface VoicesTableProps {
  incarnationName: string;
  choirName: string;
}

function VoicesTable({ incarnationName, choirName }: VoicesTableProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const voices = useQuery({
    queryKey: ['choir-voices', incarnationName, choirName],
    queryFn: () => keeperApi.choirs.listVoices(incarnationName, choirName),
  });

  const removeMu = useMutation({
    mutationFn: (sid: string) => keeperApi.choirs.removeVoice(incarnationName, choirName, sid),
    onSuccess: () => {
      setRemoveError(null);
      qc.invalidateQueries({ queryKey: ['choir-voices', incarnationName, choirName] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setRemoveError(t('errors:generic', { status: err.status, detail: err.message }));
      } else {
        setRemoveError(String(err));
      }
    },
  });

  const existingSids = (voices.data?.items ?? []).map((v: Voice) => v.sid);

  return (
    <div style={{ paddingLeft: 24, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t('incarnations:voices')}
        </span>
        <Button type="button" variant="secondary" onClick={() => setAddOpen(true)}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          {t('incarnations:addVoice')}
        </Button>
      </div>

      {voices.isLoading ? (
        <div className={styles.loading}>{t('loading')}</div>
      ) : null}
      {voices.error ? (
        <div className={styles.errorBox}>
          {t('incarnations:voicesLoadFailed', { detail: String(voices.error) })}
        </div>
      ) : null}
      {removeError ? (
        <div className={styles.errorBox}>{removeError}</div>
      ) : null}
      {voices.data && voices.data.items.length === 0 ? (
        <div className={styles.empty}>{t('incarnations:choirNoVoices')}</div>
      ) : null}
      {voices.data && voices.data.items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SID</th>
              <th>{t('incarnations:voiceRoleCol')}</th>
              <th>{t('incarnations:voicePositionCol')}</th>
              <th>{t('incarnations:voiceAddedAtCol')}</th>
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {voices.data.items.map((v: Voice) => (
              <tr key={v.sid}>
                <td className="mono">{v.sid}</td>
                <td className="mono">{v.role ?? '—'}</td>
                <td className="mono">{v.position ?? '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{v.added_at}</td>
                <td>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeMu.mutate(v.sid)}
                    disabled={removeMu.isPending}
                    aria-label={t('incarnations:removeVoiceAria', { sid: v.sid })}
                    title={t('incarnations:removeVoice')}
                    data-testid={`remove-voice-${v.sid}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <AddVoiceModal
        open={addOpen}
        incarnationName={incarnationName}
        choirName={choirName}
        existingVoiceSids={existingSids}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

// --- Main ChoirsTab ---

export function ChoirsTab({ incarnationName }: Props) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteChoir, setDeleteChoir] = useState<Choir | null>(null);
  const [expandedChoirs, setExpandedChoirs] = useState<Set<string>>(new Set());

  const choirs = useQuery({
    queryKey: ['incarnation-choirs', incarnationName],
    queryFn: () => keeperApi.choirs.list(incarnationName),
    enabled: Boolean(incarnationName),
  });

  function toggleExpand(choirName: string) {
    setExpandedChoirs((prev) => {
      const next = new Set(prev);
      if (next.has(choirName)) {
        next.delete(choirName);
      } else {
        next.add(choirName);
      }
      return next;
    });
  }

  return (
    <section className={styles.section}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
          {t('incarnations:choirsTitle')}
        </h2>
        <Button type="button" variant="secondary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {t('incarnations:createChoir')}
        </Button>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:choirsDesc')}
      </p>

      {choirs.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {choirs.error && !isChoirsDegraded(choirs.error) ? (
        <div className={styles.errorBox}>
          {t('incarnations:choirsLoadFailed', { detail: String(choirs.error) })}
        </div>
      ) : null}
      {isChoirsDegraded(choirs.error) ? (
        <div
          style={{
            padding: 'var(--s-4)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            lineHeight: 1.6,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-2)',
            marginTop: 12,
          }}
          data-testid="choirs-degraded"
        >
          <div style={{ color: 'var(--text-muted)' }}>
            {t('incarnations:choirsDegradedLead', {
              status: choirs.error instanceof ApiError ? choirs.error.status : '—',
            })}
          </div>
          <div>{t('incarnations:choirsDegradedHint')}</div>
        </div>
      ) : null}
      {choirs.data && choirs.data.items.length === 0 ? (
        <div className={styles.empty}>{t('incarnations:choirsEmpty')}</div>
      ) : null}
      {choirs.data && choirs.data.items.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {choirs.data.items.map((choir: Choir) => {
            const expanded = expandedChoirs.has(choir.choir_name);
            return (
              <div
                key={choir.choir_name}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 16px',
                    background: 'var(--surface-2)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(choir.choir_name)}
                    style={{
                      background: 'transparent',
                      border: 0,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flex: 1,
                      padding: 0,
                      textAlign: 'left',
                      color: 'inherit',
                      fontFamily: 'inherit',
                    }}
                    aria-expanded={expanded}
                    aria-label={`${t('incarnations:choirToggle')} ${choir.choir_name}`}
                    data-testid={`choir-toggle-${choir.choir_name}`}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="mono" style={{ fontWeight: 500 }}>{choir.choir_name}</span>
                    {choir.description ? (
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{choir.description}</span>
                    ) : null}
                    {(choir.min_size !== null || choir.max_size !== null) ? (
                      <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 8 }}>
                        {choir.min_size ?? '?'}…{choir.max_size ?? '∞'}
                      </span>
                    ) : null}
                  </button>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDeleteChoir(choir)}
                    aria-label={t('incarnations:deleteChoirAria', { choir: choir.choir_name })}
                    title={t('incarnations:deleteChoir')}
                    data-testid={`delete-choir-${choir.choir_name}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>

                {expanded ? (
                  <VoicesTable incarnationName={incarnationName} choirName={choir.choir_name} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <CreateChoirModal
        open={createOpen}
        incarnationName={incarnationName}
        onClose={() => setCreateOpen(false)}
      />

      <DeleteChoirModal
        choir={deleteChoir}
        incarnationName={incarnationName}
        onClose={() => setDeleteChoir(null)}
      />
    </section>
  );
}

const fieldWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
};
