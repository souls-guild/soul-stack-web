// The display time zone picker (NIM-1154), the way Grafana does it: a searchable
// list of zones with their UTC offsets, the browser's own zone and UTC pinned on top.
// The same list opens from Settings → Appearance and from the zone in the top bar.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Globe, Search } from 'lucide-react';
import { BROWSER_ZONE, useTimeZone } from '../hooks/useTimeZone';
import { browserTimeZone, timeZoneNames, utcOffsetLabel } from '../pages/incarnations/maintenance';
import css from './TimeZonePicker.module.css';

interface ZoneOption {
  value: string;
  /** The bold part: «Browser», «UTC», or the city of an IANA name. */
  name: string;
  /** The muted part: the browser's zone, what UTC stands for, or the region. */
  note: string;
  offset: string;
  haystack: string;
}

function zoneOption(zone: string, now: Date): ZoneOption {
  const cut = zone.lastIndexOf('/');
  const offset = utcOffsetLabel(zone, now);
  return {
    value: zone,
    name: zone.slice(cut + 1).replace(/_/g, ' '),
    note: cut > 0 ? zone.slice(0, cut + 1).replace(/_/g, ' ') : '',
    offset,
    haystack: `${zone.replace(/_/g, ' ')} ${offset}`.toLowerCase(),
  };
}

function matches(o: ZoneOption, q: string): boolean {
  return q === '' || o.haystack.includes(q);
}

export function TimeZoneList({ onPicked }: { onPicked?: () => void }) {
  const { t } = useTranslation();
  const { pref, setPref } = useTimeZone();
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const { pinned, zones } = useMemo(() => {
    const now = new Date();
    const own = browserTimeZone();
    const ownOffset = utcOffsetLabel(own, now);
    const utcName = t('common:tzUtcNote');
    return {
      pinned: [
        {
          value: BROWSER_ZONE,
          name: t('common:tzBrowserName'),
          note: own,
          offset: ownOffset,
          haystack: `${t('common:tzBrowserName')} browser ${own.replace(/_/g, ' ')} ${ownOffset}`.toLowerCase(),
        },
        { value: 'UTC', name: 'UTC', note: utcName, offset: 'UTC+00:00', haystack: `utc ${utcName} utc+00:00`.toLowerCase() },
      ],
      zones: timeZoneNames()
        .filter((z) => z !== 'UTC')
        .map((z) => zoneOption(z, now)),
    };
  }, [t]);

  // The list opens on the current choice, so Enter right away keeps it.
  const [active, setActive] = useState(() => Math.max(0, [...pinned, ...zones].findIndex((o) => o.value === pref)));
  // The list scrolls to the open choice and after the keys, never under the pointer.
  const scrollTo = useRef<ScrollLogicalPosition | null>('center');

  const q = query.trim().toLowerCase().replace(/_/g, ' ');
  const shownPinned = pinned.filter((o) => matches(o, q));
  const shownZones = zones.filter((o) => matches(o, q));
  const flat = [...shownPinned, ...shownZones];
  const at = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    if (scrollTo.current === null) return;
    listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView?.({ block: scrollTo.current });
    scrollTo.current = null;
  }, [at]);

  function pick(value: string) {
    setPref(value);
    onPicked?.();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      scrollTo.current = 'nearest';
      setActive((at + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[at]) pick(flat[at].value);
    }
  }

  const row = (o: ZoneOption, i: number) => (
    <li
      key={o.value}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={o.value === pref}
      data-index={i}
      data-testid={`tz-option-${o.value}`}
      className={`${css.option} ${i === at ? css.optionActive : ''}`}
      onMouseEnter={() => setActive(i)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(o.value)}
    >
      <span className={css.check}>{o.value === pref ? <Check size={14} /> : null}</span>
      <span className={css.label}>
        {o.value === BROWSER_ZONE || o.value === 'UTC' ? (
          <>
            <b>{o.name}</b>
            <span className={css.note}>{o.note}</span>
          </>
        ) : (
          <>
            <span className={css.note}>{o.note}</span>
            <b>{o.name}</b>
          </>
        )}
      </span>
      <span className={css.offset}>{o.offset}</span>
    </li>
  );

  return (
    <div className={css.panel} data-testid="tz-list">
      <div className={css.searchRow}>
        <Search size={14} className={css.searchIcon} />
        <input
          className={css.search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onKeyDown={onKey}
          placeholder={t('common:tzSearch')}
          aria-label={t('common:tzSearch')}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat[at] ? `${listId}-${at}` : undefined}
          autoFocus
          data-testid="tz-search"
        />
      </div>
      <ul className={css.list} role="listbox" id={listId} ref={listRef} aria-label={t('common:tzLabel')}>
        {shownPinned.map((o, i) => row(o, i))}
        {shownPinned.length > 0 && shownZones.length > 0 ? <li className={css.divider} role="presentation" /> : null}
        {shownZones.map((o, i) => row(o, shownPinned.length + i))}
      </ul>
      {flat.length === 0 ? <div className={css.empty}>{t('common:tzNothing')}</div> : null}
    </div>
  );
}

/** The current zone as a button that opens the list: a field in Settings, a chip in the top bar. */
export function TimeZoneMenu({ variant }: { variant: 'field' | 'chip' }) {
  const { t } = useTranslation();
  const { tz, browser } = useTimeZone();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = browser ? t('common:tzBrowser', { tz }) : tz;
  const offset = utcOffsetLabel(tz);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    ref.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
  };

  return (
    <div
      className={css.wrap}
      ref={ref}
      // Tabbing away closes it; a click on nothing focusable is the outside-click's to judge.
      onBlur={(e) => {
        if (e.relatedTarget && !ref.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      {variant === 'chip' ? (
        <button
          type="button"
          className={css.chip}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t('common:tzChange', { zone: label })}
          aria-label={t('common:tzChange', { zone: label })}
          data-testid="topbar-tz"
        >
          <Globe size={14} className={css.chipIcon} />
          <span className={css.chipZone}>{tz}</span>
          <span className={css.chipOffset}>{offset}</span>
        </button>
      ) : (
        <button
          type="button"
          className={css.field}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('common:tzLabel')}
          data-testid="tz-field"
        >
          <Globe size={15} className={css.chipIcon} />
          <span className={css.fieldLabel}>{label}</span>
          <span className={css.chipOffset}>{offset}</span>
          <ChevronDown size={14} className={css.caret} />
        </button>
      )}
      {open ? (
        <div className={variant === 'chip' ? `${css.pop} ${css.popRight}` : css.pop}>
          <TimeZoneList onPicked={close} />
        </div>
      ) : null}
    </div>
  );
}
