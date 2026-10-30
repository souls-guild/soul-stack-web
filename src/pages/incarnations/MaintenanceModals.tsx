import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type Freeze, type MaintenanceWindow } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useTimeZone } from '../../hooks/useTimeZone';
import {
  WEEKDAYS,
  durationBetween,
  formatDays,
  formatOnceRange,
  freezesKey,
  isOnce,
  isWeekday,
  isWholeDays,
  isoToWall,
  nextDay,
  prevDay,
  slotEnd,
  timeZoneNames,
  wallToIso,
  windowCounts,
  windowsKey,
  type Weekday,
} from './maintenance';
import {
  freezeRangeFromForm,
  freezeSchema,
  maintenanceWindowSchema,
  onceRangeFromForm,
  onceWindowSchemaFor,
  type FreezeFormValues,
  type MaintenanceWindowFormValues,
  type OnceWindowFormValues,
} from './schemas';
import styles from '../common.module.css';

function errorText(err: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (err instanceof ApiError) return t('errors:generic', { status: err.status, detail: err.message });
  return String(err);
}

// --- window: create / edit ---

export type WindowKind = 'weekly' | 'once';

interface WindowModalProps {
  open: boolean;
  incarnationName: string;
  // null → create.
  editing: MaintenanceWindow | null;
  // The kind to create; an edited row keeps its own.
  kind?: WindowKind;
  onClose: () => void;
}

// A new weekly window starts in the display zone; an edited one keeps its own.
function windowDefaults(w: MaintenanceWindow | null, tz: string): MaintenanceWindowFormValues {
  if (!w) {
    return { days: [], start: '02:00', end: '05:00', timezone: tz, comment: '' };
  }
  const start = w.start_time ?? '02:00';
  return {
    days: (w.days ?? []).filter(isWeekday),
    start,
    end: slotEnd(start, w.duration_minutes ?? 0).end,
    timezone: w.timezone ?? tz,
    comment: w.comment ?? '',
  };
}

export function WindowModal({ open, incarnationName, editing, kind = 'weekly', onClose }: WindowModalProps) {
  if (!open) return null;
  // Keyed so a reopened modal starts from the row it edits, not from the last draft.
  const once = editing ? isOnce(editing) : kind === 'once';
  return once ? (
    <OnceWindowModalBody key={editing?.id ?? 'new-once'} incarnationName={incarnationName} editing={editing} onClose={onClose} />
  ) : (
    <WindowModalBody key={editing?.id ?? 'new'} incarnationName={incarnationName} editing={editing} onClose={onClose} />
  );
}

function WindowModalBody({ incarnationName, editing, onClose }: Omit<WindowModalProps, 'open' | 'kind'>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const zones = useMemo(() => timeZoneNames(), []);
  const { tz } = useTimeZone();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<MaintenanceWindowFormValues>({
    resolver: zodResolver(maintenanceWindowSchema),
    defaultValues: windowDefaults(editing, tz),
  });

  const start = watch('start');
  const end = watch('end');
  const duration = durationBetween(start, end);

  const mu = useMutation({
    mutationFn: (v: MaintenanceWindowFormValues) => {
      const body = {
        kind: 'weekly' as const,
        days: WEEKDAYS.filter((d) => v.days.includes(d)),
        start_time: v.start,
        duration_minutes: durationBetween(v.start, v.end) ?? 0,
        timezone: v.timezone.trim(),
        comment: v.comment.trim() || undefined,
      };
      return editing
        ? keeperApi.maintenance.updateWindow(incarnationName, editing.id, body)
        : keeperApi.maintenance.createWindow(incarnationName, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: windowsKey(incarnationName) });
      onClose();
    },
    onError: (err) => setServerError(errorText(err, t)),
  });

  function close() {
    if (mu.isPending) return;
    onClose();
  }

  return (
    <Modal
      open
      title={editing ? t('incarnations:mwEditTitle') : t('incarnations:mwAddTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mu.isPending}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
            data-testid="mw-submit"
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={introStyle}>{t('incarnations:mwDesc')}</p>
        <fieldset style={{ ...fieldWrapStyle, border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend style={labelStyle}>{t('incarnations:mwDaysLabel')}</legend>
          <Controller
            control={control}
            name="days"
            render={({ field }) => (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WEEKDAYS.map((d) => {
                  const on = field.value.includes(d);
                  return (
                    <label key={d} style={{ ...dayChipStyle, ...(on ? dayChipOnStyle : null) }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          field.onChange(on ? field.value.filter((x) => x !== d) : [...field.value, d])
                        }
                        data-testid={`mw-day-${d}`}
                        style={{ margin: 0 }}
                      />
                      {dayLabel(d)}
                    </label>
                  );
                })}
              </div>
            )}
          />
          {errors.days ? <span style={errStyle}>{t(errors.days.message ?? '')}</span> : null}
        </fieldset>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{t('incarnations:mwStartLabel')}</span>
            <input type="time" {...register('start')} style={inputStyle} data-testid="mw-start" />
            {errors.start ? <span style={errStyle}>{t(errors.start.message ?? '')}</span> : null}
          </label>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{t('incarnations:mwEndLabel')}</span>
            <input type="time" {...register('end')} style={inputStyle} data-testid="mw-end" />
            {errors.end ? <span style={errStyle}>{t(errors.end.message ?? '')}</span> : null}
          </label>
        </div>
        {duration !== null ? (
          <div style={hintStyle} data-testid="mw-duration-hint">
            {t('incarnations:mwDurationHint', {
              hours: Math.floor(duration / 60),
              minutes: duration % 60,
            })}
            {slotEnd(start, duration).nextDay ? ` ${t('incarnations:mwCrossesMidnight')}` : ''}
          </div>
        ) : null}

        <label style={{ ...fieldWrapStyle, marginTop: 12 }}>
          <span style={labelStyle}>{t('incarnations:mwTimezoneLabel')}</span>
          <input
            type="text"
            list="mw-timezones"
            spellCheck={false}
            {...register('timezone')}
            style={inputStyle}
            data-testid="mw-timezone"
          />
          <datalist id="mw-timezones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          {errors.timezone ? <span style={errStyle}>{t(errors.timezone.message ?? '')}</span> : null}
        </label>

        <label style={fieldWrapStyle}>
          <span style={labelStyle}>{t('incarnations:mwCommentLabel')}</span>
          <input
            type="text"
            maxLength={500}
            placeholder={t('incarnations:mwCommentPlaceholder')}
            {...register('comment')}
            style={{ ...inputStyle, fontFamily: 'inherit' }}
            data-testid="mw-comment"
          />
          {errors.comment ? <span style={errStyle}>{t(errors.comment.message ?? '')}</span> : null}
        </label>

        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}

// --- one-off window: create / edit ---

/** A new one-off window starts on the next whole hour and lasts two. */
function onceDefaults(w: MaintenanceWindow | null, tz: string): OnceWindowFormValues {
  if (w) {
    const s = isoToWall(w.starts_at ?? '', tz);
    const e = isoToWall(w.ends_at ?? '', tz);
    return { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, comment: w.comment ?? '' };
  }
  const now = isoToWall(new Date().toISOString(), tz);
  const hour = Number(now.time.slice(0, 2)) + 1;
  const start = wallToIso(hour > 23 ? nextDay(now.date) : now.date, `${String(hour % 24).padStart(2, '0')}:00`, tz);
  const s = isoToWall(start ?? new Date().toISOString(), tz);
  const e = isoToWall(new Date(Date.parse(start ?? '') + 2 * 3_600_000).toISOString(), tz);
  return { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, comment: '' };
}

function OnceWindowModalBody({ incarnationName, editing, onClose }: Omit<WindowModalProps, 'open' | 'kind'>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { tz, browser } = useTimeZone();

  const schema = useMemo(() => onceWindowSchemaFor(editing?.ends_at), [editing?.ends_at]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OnceWindowFormValues>({
    resolver: zodResolver(schema),
    defaultValues: onceDefaults(editing, tz),
  });

  const mu = useMutation({
    mutationFn: (v: OnceWindowFormValues) => {
      const range = onceRangeFromForm(v, tz);
      if (!range) throw new Error(t('incarnations:freezeDateRequired'));
      const body = { kind: 'once' as const, ...range, comment: v.comment.trim() || undefined };
      return editing
        ? keeperApi.maintenance.updateWindow(incarnationName, editing.id, body)
        : keeperApi.maintenance.createWindow(incarnationName, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: windowsKey(incarnationName) });
      onClose();
    },
    onError: (err) => setServerError(errorText(err, t)),
  });

  function close() {
    if (mu.isPending) return;
    onClose();
  }

  return (
    <Modal
      open
      title={editing ? t('incarnations:mwOnceEditTitle') : t('incarnations:mwOnceAddTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mu.isPending}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
            data-testid="mw-once-submit"
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={introStyle}>{t('incarnations:mwOnceDesc')}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{t('incarnations:freezeStarts')}</span>
            <input type="date" {...register('startDate')} style={inputStyle} data-testid="mw-once-start-date" />
            <input type="time" {...register('startTime')} style={inputStyle} data-testid="mw-once-start-time" />
            {errors.startDate ? <span style={errStyle}>{t(errors.startDate.message ?? '')}</span> : null}
            {errors.startTime ? <span style={errStyle}>{t(errors.startTime.message ?? '')}</span> : null}
          </label>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{t('incarnations:freezeEnds')}</span>
            <input type="date" {...register('endDate')} style={inputStyle} data-testid="mw-once-end-date" />
            <input type="time" {...register('endTime')} style={inputStyle} data-testid="mw-once-end-time" />
            {errors.endDate ? <span style={errStyle}>{t(errors.endDate.message ?? '')}</span> : null}
            {errors.endTime ? <span style={errStyle}>{t(errors.endTime.message ?? '')}</span> : null}
          </label>
        </div>
        <div style={hintStyle} data-testid="mw-once-zone">{t(browser ? 'incarnations:freezeBrowserZone' : 'incarnations:freezeChosenZone', { tz })}</div>

        <label style={{ ...fieldWrapStyle, marginTop: 12 }}>
          <span style={labelStyle}>{t('incarnations:mwCommentLabel')}</span>
          <input
            type="text"
            maxLength={500}
            placeholder={t('incarnations:mwOnceCommentPlaceholder')}
            {...register('comment')}
            style={{ ...inputStyle, fontFamily: 'inherit' }}
            data-testid="mw-once-comment"
          />
          {errors.comment ? <span style={errStyle}>{t(errors.comment.message ?? '')}</span> : null}
        </label>

        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}

// --- freeze: create / edit ---

interface FreezeModalProps {
  open: boolean;
  incarnationName: string;
  editing: Freeze | null;
  onClose: () => void;
}

function freezeDefaults(f: Freeze | null, tz: string): FreezeFormValues {
  if (!f) {
    const today = isoToWall(new Date().toISOString(), tz).date;
    return { wholeDays: true, startDate: today, startTime: '00:00', endDate: today, endTime: '00:00', comment: '' };
  }
  const s = isoToWall(f.starts_at, tz);
  const e = isoToWall(f.ends_at, tz);
  const whole = isWholeDays(f.starts_at, f.ends_at, tz);
  return {
    wholeDays: whole,
    startDate: s.date,
    startTime: s.time,
    endDate: whole ? prevDay(e.date) : e.date,
    endTime: e.time,
    comment: f.comment ?? '',
  };
}

/**
 * The end fields mean different things in the two modes — the inclusive last day,
 * or the exclusive end moment — so switching modes converts them; left as typed,
 * unticking «Whole days» on [20.11, 03.12) would save a freeze ending 02.12 00:00.
 */
function endForMode(v: Pick<FreezeFormValues, 'endDate' | 'endTime'>, toWholeDays: boolean) {
  if (toWholeDays) {
    return { endDate: v.endTime === '00:00' ? prevDay(v.endDate) : v.endDate, endTime: '00:00' };
  }
  return { endDate: nextDay(v.endDate), endTime: '00:00' };
}

export function FreezeModal({ open, incarnationName, editing, onClose }: FreezeModalProps) {
  if (!open) return null;
  return (
    <FreezeModalBody
      key={editing?.id ?? 'new'}
      incarnationName={incarnationName}
      editing={editing}
      onClose={onClose}
    />
  );
}

function FreezeModalBody({ incarnationName, editing, onClose }: Omit<FreezeModalProps, 'open'>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { tz, browser } = useTimeZone();

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FreezeFormValues>({
    resolver: zodResolver(freezeSchema),
    defaultValues: freezeDefaults(editing, tz),
  });
  const wholeDays = watch('wholeDays');
  const wholeDaysField = register('wholeDays', {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const end = endForMode(getValues(), e.target.checked);
      setValue('endDate', end.endDate);
      setValue('endTime', end.endTime);
    },
  });

  const mu = useMutation({
    mutationFn: (v: FreezeFormValues) => {
      const range = freezeRangeFromForm(v, tz);
      if (!range) throw new Error(t('incarnations:freezeDateRequired'));
      const body = { ...range, comment: v.comment.trim() || undefined };
      return editing
        ? keeperApi.maintenance.updateFreeze(incarnationName, editing.id, body)
        : keeperApi.maintenance.createFreeze(incarnationName, body);
    },
    onSuccess: () => {
      // A freeze moves the status block too, and that lives on the windows reply.
      qc.invalidateQueries({ queryKey: freezesKey(incarnationName) });
      qc.invalidateQueries({ queryKey: windowsKey(incarnationName) });
      onClose();
    },
    onError: (err) => setServerError(errorText(err, t)),
  });

  function close() {
    if (mu.isPending) return;
    onClose();
  }

  return (
    <Modal
      open
      title={editing ? t('incarnations:freezeEditTitle') : t('incarnations:freezeAddTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mu.isPending}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
            data-testid="freeze-submit"
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('incarnations:freezesDesc')}
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" {...wholeDaysField} data-testid="freeze-whole-days" />
          {t('incarnations:freezeWholeDays')}
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{wholeDays ? t('incarnations:freezeFirstDay') : t('incarnations:freezeStarts')}</span>
            <input type="date" {...register('startDate')} style={inputStyle} data-testid="freeze-start-date" />
            {!wholeDays ? (
              <input type="time" {...register('startTime')} style={inputStyle} data-testid="freeze-start-time" />
            ) : null}
            {errors.startDate ? <span style={errStyle}>{t(errors.startDate.message ?? '')}</span> : null}
            {errors.startTime ? <span style={errStyle}>{t(errors.startTime.message ?? '')}</span> : null}
          </label>
          <label style={{ ...fieldWrapStyle, flex: 1 }}>
            <span style={labelStyle}>{wholeDays ? t('incarnations:freezeLastDay') : t('incarnations:freezeEnds')}</span>
            <input type="date" {...register('endDate')} style={inputStyle} data-testid="freeze-end-date" />
            {!wholeDays ? (
              <input type="time" {...register('endTime')} style={inputStyle} data-testid="freeze-end-time" />
            ) : null}
            {errors.endDate ? <span style={errStyle}>{t(errors.endDate.message ?? '')}</span> : null}
            {errors.endTime ? <span style={errStyle}>{t(errors.endTime.message ?? '')}</span> : null}
          </label>
        </div>
        <div style={hintStyle} data-testid="freeze-modal-zone">{t(browser ? 'incarnations:freezeBrowserZone' : 'incarnations:freezeChosenZone', { tz })}</div>

        <label style={{ ...fieldWrapStyle, marginTop: 12 }}>
          <span style={labelStyle}>{t('incarnations:mwCommentLabel')}</span>
          <input
            type="text"
            maxLength={500}
            placeholder={t('incarnations:freezeCommentPlaceholder')}
            {...register('comment')}
            style={{ ...inputStyle, fontFamily: 'inherit' }}
            data-testid="freeze-comment"
          />
          {errors.comment ? <span style={errStyle}>{t(errors.comment.message ?? '')}</span> : null}
        </label>

        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}

// --- delete (window or freeze) ---

export type DeleteTarget =
  | { kind: 'window'; row: MaintenanceWindow; summary: string }
  | { kind: 'freeze'; row: Freeze; summary: string };

export function DeleteMaintenanceModal({
  target,
  incarnationName,
  onClose,
}: {
  target: DeleteTarget | null;
  incarnationName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => {
      if (!target) return Promise.resolve();
      return target.kind === 'window'
        ? keeperApi.maintenance.deleteWindow(incarnationName, target.row.id)
        : keeperApi.maintenance.deleteFreeze(incarnationName, target.row.id);
    },
    // Not close(): this callback comes from the render where the mutation is
    // pending, and close() refuses to close a pending mutation.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: windowsKey(incarnationName) });
      qc.invalidateQueries({ queryKey: freezesKey(incarnationName) });
      setError(null);
      onClose();
    },
    onError: (err) => setError(errorText(err, t)),
  });

  function close() {
    if (mu.isPending) return;
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={target !== null}
      title={target?.kind === 'freeze' ? t('incarnations:freezeDeleteTitle') : t('incarnations:mwDeleteTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => mu.mutate()}
            disabled={mu.isPending}
            data-testid="maintenance-delete-confirm"
          >
            {mu.isPending ? t('deleting') : t('delete')}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13, margin: 0 }} className="mono">{target?.summary}</p>
      {error ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}

export function NextDayMark() {
  const { t } = useTranslation();
  return <span style={nextDayStyle}>{t('incarnations:mwNextDayMark')}</span>;
}

// --- copy windows from another incarnation ---

export function CopyWindowsModal({
  open,
  incarnationName,
  currentWindows,
  onClose,
}: {
  open: boolean;
  incarnationName: string;
  currentWindows: MaintenanceWindow[];
  onClose: () => void;
}) {
  if (!open) return null;
  return <CopyWindowsBody incarnationName={incarnationName} currentWindows={currentWindows} onClose={onClose} />;
}

function CopyWindowsBody({
  incarnationName,
  currentWindows,
  onClose,
}: {
  incarnationName: string;
  currentWindows: MaintenanceWindow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [source, setSource] = useState('');
  const [picked, setPicked] = useState('');
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);

  const candidates = useQuery({
    queryKey: ['incarnations.list', 'maintenance-copy'],
    queryFn: () => keeperApi.incarnations.list({ limit: 500, sort: 'id', sort_dir: 'asc' }),
    retry: false,
  });

  const sourceWindows = useQuery({
    queryKey: windowsKey(picked),
    queryFn: () => keeperApi.maintenance.listWindows(picked),
    enabled: picked !== '',
    retry: false,
  });
  // An ended one-off window no longer counts: copied, it would be a dead row.
  const [openedAt] = useState(() => new Date());
  const toCopy = (sourceWindows.data?.items ?? []).filter((w) => windowCounts(w, openedAt));
  const { tz } = useTimeZone();

  // Sequential on purpose: a half-done copy must say how far it got, and parallel
  // requests would leave the order of the copied rows to the network.
  //
  // "Replace" creates first and deletes after. Deleting first and failing halfway
  // would leave the incarnation without its windows — open at any time, or on the
  // cluster default — which is not what the operator was setting up.
  const mu = useMutation({
    mutationFn: async () => {
      const progress = { created: 0, removed: 0 };
      try {
        for (const w of toCopy) {
          await keeperApi.maintenance.createWindow(
            incarnationName,
            isOnce(w)
              ? { kind: 'once', starts_at: w.starts_at, ends_at: w.ends_at, comment: w.comment || undefined }
              : {
                  kind: 'weekly',
                  days: (w.days ?? []).filter(isWeekday),
                  start_time: w.start_time,
                  duration_minutes: w.duration_minutes,
                  timezone: w.timezone,
                  comment: w.comment || undefined,
                },
          );
          progress.created++;
        }
        if (replace) {
          for (const w of currentWindows) {
            await keeperApi.maintenance.deleteWindow(incarnationName, w.id);
            progress.removed++;
          }
        }
      } catch (err) {
        throw new CopyError(progress, err);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: windowsKey(incarnationName) });
    },
    onSuccess: () => onClose(),
    onError: (err) => {
      if (err instanceof CopyError) {
        setError(
          replace
            ? t('incarnations:mwCopyPartialReplace', {
                created: err.created,
                total: toCopy.length,
                removed: err.removed,
                old: currentWindows.length,
                detail: errorText(err.cause, t),
              })
            : t('incarnations:mwCopyPartial', { done: err.created, total: toCopy.length, detail: errorText(err.cause, t) }),
        );
      } else {
        setError(errorText(err, t));
      }
    },
  });

  const sameAsTarget = picked === incarnationName;
  const canCopy = picked !== '' && !sameAsTarget && toCopy.length > 0 && !mu.isPending;

  return (
    <Modal
      open
      wide
      title={t('incarnations:mwCopyTitle')}
      onClose={() => { if (!mu.isPending) onClose(); }}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => { setError(null); mu.mutate(); }}
            disabled={!canCopy}
            data-testid="mw-copy-submit"
          >
            {t('incarnations:mwCopySubmit', { n: toCopy.length })}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        {t('incarnations:mwCopyDesc')}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ ...fieldWrapStyle, flex: 1, marginBottom: 0 }}>
          <span style={labelStyle}>{t('incarnations:mwCopySource')}</span>
          <input
            type="text"
            list="mw-copy-sources"
            value={source}
            spellCheck={false}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setPicked(source.trim()); } }}
            placeholder="redis-prod"
            style={inputStyle}
            data-testid="mw-copy-source"
          />
          <datalist id="mw-copy-sources">
            {(candidates.data?.items ?? [])
              .filter((i) => i.id !== incarnationName)
              .map((i) => (
                <option key={i.id} value={i.id} />
              ))}
          </datalist>
        </label>
        <Button type="button" variant="secondary" onClick={() => setPicked(source.trim())} data-testid="mw-copy-load">
          {t('incarnations:mwCopyLoad')}
        </Button>
      </div>

      {sameAsTarget ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{t('incarnations:mwCopySame')}</div> : null}
      {picked && !sameAsTarget && sourceWindows.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {picked && !sameAsTarget && sourceWindows.error ? (
        <div className={styles.errorBox} style={{ marginTop: 12 }}>{errorText(sourceWindows.error, t)}</div>
      ) : null}
      {picked && !sameAsTarget && sourceWindows.data && toCopy.length === 0 ? (
        <div className={styles.empty} style={{ marginTop: 12 }}>{t('incarnations:mwCopyNone', { name: picked })}</div>
      ) : null}
      {!sameAsTarget && toCopy.length > 0 ? (
        <table className={styles.table} style={{ marginTop: 12 }} data-testid="mw-copy-preview">
          <tbody>
            {toCopy.map((w) => {
              if (isOnce(w)) {
                return (
                  <tr key={w.id}>
                    <td>{t('incarnations:mwOnceShort')}</td>
                    <td className="mono">{formatOnceRange(w.starts_at ?? '', w.ends_at ?? '', tz, openedAt)}</td>
                    <td className="mono">{tz}</td>
                    <td style={{ color: w.comment ? 'var(--text-muted)' : 'var(--text-faint)' }}>{w.comment || '—'}</td>
                  </tr>
                );
              }
              const end = slotEnd(w.start_time ?? '', w.duration_minutes ?? 0);
              return (
                <tr key={w.id}>
                  <td>{formatDays(w.days, dayLabel)}</td>
                  <td className="mono">
                    {w.start_time}–{end.end}
                    {end.nextDay ? <NextDayMark /> : null}
                  </td>
                  <td className="mono">{w.timezone}</td>
                  <td style={{ color: w.comment ? 'var(--text-muted)' : 'var(--text-faint)' }}>{w.comment || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {currentWindows.length > 0 && toCopy.length > 0 && !sameAsTarget ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 12 }}>
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            data-testid="mw-copy-replace"
          />
          {t('incarnations:mwCopyReplace', { n: currentWindows.length })}
        </label>
      ) : null}

      {error ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}

class CopyError extends Error {
  created: number;
  removed: number;
  override cause: unknown;
  constructor(progress: { created: number; removed: number }, cause: unknown) {
    super('copy interrupted');
    this.created = progress.created;
    this.removed = progress.removed;
    this.cause = cause;
  }
}

const introStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' };
const fieldWrapStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 };
const labelStyle: React.CSSProperties = { fontSize: 13, padding: 0 };
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: 'var(--text-muted)' };
const nextDayStyle: React.CSSProperties = { marginLeft: 6, fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-faint)' };
const errStyle: React.CSSProperties = { color: 'var(--danger)', fontSize: 12 };
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
};
const dayChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  fontSize: 13,
  cursor: 'pointer',
};
const dayChipOnStyle: React.CSSProperties = { background: 'var(--surface-2)', borderColor: 'var(--accent, var(--border))' };
