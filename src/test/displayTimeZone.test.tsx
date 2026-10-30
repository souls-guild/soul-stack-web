import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { MaintenanceTab } from '../pages/incarnations/MaintenanceTab';
import { TimeZoneMenu } from '../components/TimeZonePicker';
import { AppearanceSettings } from '../pages/settings/AppearanceSettings';
import { DeferredUntil } from '../pages/voyages/DeferredUntil';
import { FontProvider } from '../hooks/useFont';
import { FreezeConsentBlock } from '../pages/incarnations/FreezeConsent';
import { TIME_ZONE_STORAGE_KEY, displayTimeZone, setTimeZonePref } from '../hooks/useTimeZone';
import { utcOffsetLabel } from '../pages/incarnations/maintenance';

// The display time zone (NIM-1154). The browser's own zone is pinned to Moscow, so
// "browser" and a chosen zone differ and the runner's TZ plays no part.
vi.mock('../pages/incarnations/maintenance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../pages/incarnations/maintenance')>();
  return { ...mod, browserTimeZone: () => 'Europe/Moscow' };
});

const BASE = '/v1/incarnations/df-prod';
const WRITER = {
  permissions: [
    { resource: 'incarnation', action: 'get', wildcard: false },
    { resource: 'incarnation', action: 'maintenance-set', wildcard: false },
  ],
};
const NIGHT = {
  id: 'w-night',
  kind: 'weekly',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start_time: '02:00',
  duration_minutes: 180,
  timezone: 'Europe/Moscow',
  comment: 'night works',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T10:00:00Z',
};
// Friday 30.10 00:50 in Moscow, Thursday 29.10 21:50 UTC, Thursday 17:50 in New York.
const NOW = new Date('2026-10-29T21:50:00Z');
// Friday 02:00 in Moscow.
const CLOSED = { open_now: false, next_start: '2026-10-29T23:00:00Z' };

function routes(extra: FetchRoute[] = []): FetchRoute[] {
  return [
    ...extra,
    { method: 'GET', url: '/v1/me/permissions', body: WRITER },
    { method: 'GET', url: `${BASE}/maintenance-windows`, body: { items: [NIGHT], status: CLOSED } },
    { method: 'GET', url: `${BASE}/freezes`, body: { items: [] } },
  ];
}

function sent(method: string, urlPrefix: string): Array<{ url: string; body: unknown }> {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return calls
    .filter(([u, init]) => (init?.method ?? 'GET') === method && u.startsWith(urlPrefix))
    .map(([u, init]) => ({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
}

function marks(date: string) {
  const row = screen.getByTestId(`mw-cal-day-${date}`);
  return Array.from(row.querySelectorAll<HTMLElement>('[data-testid="mw-cal-mark"]')).map((el) => ({
    ref: el.dataset.ref,
    at: `${parseFloat(el.style.left).toFixed(2)}+${parseFloat(el.style.width).toFixed(2)}`,
  }));
}

const statusSub = () => screen.getByTestId('mw-status-sub').textContent ?? '';

describe('display time zone', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[GUARD] switching the zone moves the calendar and the status block together', async () => {
    installFetchMock(routes());
    renderWithProviders(
      <>
        <TimeZoneMenu variant="chip" />
        <MaintenanceTab incarnationName="df-prod" />
      </>,
    );
    const user = userEvent.setup();

    await screen.findByTestId('mw-calendar');
    expect(statusSub()).toContain('Opens Fri 30.10 at 02:00');
    expect(screen.getByTestId('mw-status-zone').textContent).toBe("times in your browser's zone Europe/Moscow");
    expect(marks('2026-10-30')[0]).toEqual({ ref: 'w-night', at: '8.33+12.50' });
    expect(screen.getByTestId('topbar-tz').textContent).toBe('Europe/MoscowUTC+03:00');

    await user.click(screen.getByTestId('topbar-tz'));
    await user.click(screen.getByTestId('tz-option-UTC'));

    // The same opening, 23:00 on Thursday, in both.
    expect(statusSub()).toContain('Opens Thu 29.10 at 23:00');
    expect(marks('2026-10-29')).toContainEqual({ ref: 'w-night', at: '95.83+4.17' });
    expect(marks('2026-10-30')[0]).toEqual({ ref: 'w-night', at: '0.00+8.33' });
    expect(screen.getByTestId('mw-cal-day-2026-10-29').dataset.today).toBe('true');
    expect(within(screen.getByTestId('mw-cal-day-2026-10-29')).getByTestId('mw-cal-now').textContent).toBe('now 21:50');
    expect(screen.getByTestId('mw-status-zone').textContent).toBe('times in the zone UTC');
    expect(screen.getByTestId('mw-cal-zone').textContent).toMatch(/^zone UTC/);
    expect(screen.getByTestId('topbar-tz').textContent).toBe('UTCUTC+00:00');
  });

  it('[GUARD] a freeze typed in the chosen zone is stored at that zone\'s instant, across its DST change', async () => {
    setTimeZonePref('America/New_York');
    installFetchMock(routes([{ method: 'POST', url: `${BASE}/freezes`, status: 201, body: {} }]));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-add'));
    expect(screen.getByTestId('freeze-modal-zone').textContent).toBe('Dates and times are in the time zone America/New_York.');
    await user.click(screen.getByTestId('freeze-whole-days'));
    const fill = async (id: string, v: string) => {
      const el = screen.getByTestId(id);
      await user.clear(el);
      await user.type(el, v);
    };
    // 10:00 on both days: still EDT on Saturday, EST again by Monday.
    await fill('freeze-start-date', '2026-10-31');
    await fill('freeze-start-time', '10:00');
    await fill('freeze-end-date', '2026-11-02');
    await fill('freeze-end-time', '10:00');
    await user.click(screen.getByTestId('freeze-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/freezes`)).toHaveLength(1));
    expect(sent('POST', `${BASE}/freezes`)[0].body).toMatchObject({
      starts_at: '2026-10-31T14:00:00.000Z',
      ends_at: '2026-11-02T15:00:00.000Z',
    });
  });

  it('[GUARD] a one-off window typed in the chosen zone is stored at that zone\'s instant', async () => {
    setTimeZonePref('Asia/Kathmandu');
    installFetchMock(routes([{ method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: {} }]));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-add'));
    await user.click(screen.getByTestId('mw-add-once'));
    expect(screen.getByTestId('mw-once-zone').textContent).toBe('Dates and times are in the time zone Asia/Kathmandu.');
    const fill = async (id: string, v: string) => {
      const el = screen.getByTestId(id);
      await user.clear(el);
      await user.type(el, v);
    };
    await fill('mw-once-start-date', '2026-11-03');
    await fill('mw-once-start-time', '20:00');
    await fill('mw-once-end-date', '2026-11-03');
    await fill('mw-once-end-time', '23:00');
    await user.click(screen.getByTestId('mw-once-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(1));
    // UTC+05:45.
    expect(sent('POST', `${BASE}/maintenance-windows`)[0].body).toMatchObject({
      kind: 'once',
      starts_at: '2026-11-03T14:15:00.000Z',
      ends_at: '2026-11-03T17:15:00.000Z',
    });
  });

  it('[GUARD] the calendar draws by the wall clock of the chosen zone on both sides of its DST change', async () => {
    setTimeZonePref('America/New_York');
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    await screen.findByTestId('mw-calendar');
    // Friday 02:00 in Moscow is Thursday 19:00 EDT; Monday 02:00 in Moscow is
    // Sunday 18:00 EST, after New York turned its clocks back on 1 November.
    expect(screen.getByTestId('mw-cal-range').textContent).toBe('26 October – 1 November 2026');
    expect(marks('2026-10-29')).toEqual([{ ref: 'w-night', at: '79.17+12.50' }]);
    expect(marks('2026-11-01')).toEqual([{ ref: 'w-night', at: '75.00+12.50' }]);
    expect(statusSub()).toContain('Opens Thu 29.10 at 19:00');
  });

  it('[GUARD] a choice left by an earlier page is the one a new page starts with', async () => {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, 'Asia/Tokyo');
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    expect((await screen.findByTestId('mw-status-zone')).textContent).toBe('times in the zone Asia/Tokyo');
    expect(statusSub()).toContain('Opens Fri 30.10 at 08:00');
  });

  it('[GUARD] the choice survives a reload', async () => {
    installFetchMock(routes());
    const first = renderWithProviders(
      <FontProvider>
        <AppearanceSettings />
      </FontProvider>,
    );
    const user = userEvent.setup();

    expect(screen.getByTestId('tz-field').textContent).toContain('Browser (Europe/Moscow)');
    await user.click(screen.getByTestId('tz-field'));
    await user.type(screen.getByTestId('tz-search'), 'new york');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('tz-field').textContent).toContain('America/New_York');
    first.unmount();

    // Nothing but the storage carries it over.
    expect(window.localStorage.getItem(TIME_ZONE_STORAGE_KEY)).toBe('America/New_York');
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    expect((await screen.findByTestId('mw-status-zone')).textContent).toBe('times in the zone America/New_York');
  });

  it('[GUARD] an existing weekly window keeps its own zone; a new one starts in the chosen zone', async () => {
    setTimeZonePref('UTC');
    installFetchMock(routes([{ method: 'PUT', url: `${BASE}/maintenance-windows/w-night`, body: NIGHT }]));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-edit-w-night'));
    expect((screen.getByTestId('mw-timezone') as HTMLInputElement).value).toBe('Europe/Moscow');
    await user.type(screen.getByTestId('mw-comment'), ', moved');
    await user.click(screen.getByTestId('mw-submit'));
    await waitFor(() => expect(sent('PUT', `${BASE}/maintenance-windows/w-night`)).toHaveLength(1));
    expect(sent('PUT', `${BASE}/maintenance-windows/w-night`)[0].body).toMatchObject({
      start_time: '02:00',
      timezone: 'Europe/Moscow',
    });
    // The row still names its own zone.
    expect(screen.getByTestId('mw-row-w-night').textContent).toContain('Europe/Moscow');

    await waitFor(() => expect(screen.queryByTestId('mw-submit')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('mw-add'));
    await user.click(screen.getByTestId('mw-add-weekly'));
    expect((screen.getByTestId('mw-timezone') as HTMLInputElement).value).toBe('UTC');
  });

  it('a deferred run reads «deferred until» in the chosen zone', () => {
    setTimeZonePref('UTC');
    installFetchMock([]);
    renderWithProviders(<DeferredUntil voyageId="v1" scheduleAt="2026-10-29T23:00:00Z" invalidate={[]} />);
    expect(screen.getByTestId('deferred-until-v1').textContent).toContain('Thu 29.10 23:00');
    act(() => setTimeZonePref('browser'));
    expect(screen.getByTestId('deferred-until-v1').textContent).toContain('Fri 30.10 02:00');
  });

  it('the freeze consent in the Run dialog names the freeze end in the chosen zone', () => {
    setTimeZonePref('UTC');
    renderWithProviders(
      <FreezeConsentBlock
        freeze={{ id: 'f', starts_at: '2026-10-29T00:00:00Z', ends_at: '2026-10-31T21:00:00Z', comment: 'Sale', created_at: '', updated_at: '' }}
        refusal={null}
        consent={false}
        onConsentChange={() => {}}
      />,
    );
    expect(screen.getByTestId('freeze-consent-block').textContent).toContain('Sat 31.10 21:00');
  });

  it('the picker opens on the current choice, and Enter right away keeps it', async () => {
    setTimeZonePref('Asia/Tokyo');
    installFetchMock([]);
    renderWithProviders(<TimeZoneMenu variant="field" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tz-field'));
    const active = screen.getByTestId('tz-search').getAttribute('aria-activedescendant');
    expect(document.getElementById(active ?? '')?.dataset.testid).toBe('tz-option-Asia/Tokyo');
    await user.keyboard('{Enter}');
    expect(displayTimeZone()).toBe('Asia/Tokyo');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('the picker: the browser zone and UTC on top, every zone with its offset, found by name or offset', async () => {
    installFetchMock([]);
    renderWithProviders(<TimeZoneMenu variant="field" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tz-field'));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0].textContent).toBe('BrowserEurope/MoscowUTC+03:00');
    expect(options[1].textContent).toBe('UTCCoordinated Universal TimeUTC+00:00');
    expect(screen.getByTestId('tz-option-browser').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('tz-option-Asia/Kolkata').textContent).toBe('Asia/KolkataUTC+05:30');

    await user.type(screen.getByTestId('tz-search'), 'utc+05:45');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.dataset.testid)).toEqual([
      'tz-option-Asia/Kathmandu',
    ]);
    await user.click(screen.getByTestId('tz-option-Asia/Kathmandu'));
    expect(displayTimeZone()).toBe('Asia/Kathmandu');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('an offset is the zone\'s own at the instant, DST included', () => {
    expect(utcOffsetLabel('America/New_York', new Date('2026-10-31T12:00:00Z'))).toBe('UTC-04:00');
    expect(utcOffsetLabel('America/New_York', new Date('2026-11-02T12:00:00Z'))).toBe('UTC-05:00');
    expect(utcOffsetLabel('Asia/Kolkata')).toBe('UTC+05:30');
  });

  it('an unknown stored zone falls back to the browser\'s', () => {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, 'Mars/Olympus');
    expect(displayTimeZone()).toBe('Europe/Moscow');
  });
});
