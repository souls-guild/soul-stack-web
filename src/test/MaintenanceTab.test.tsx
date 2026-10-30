import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { MaintenanceTab } from '../pages/incarnations/MaintenanceTab';

// Every instant on the tab is rendered in the browser's zone. Pinned so the
// assertions read the user's own example and do not depend on the runner's TZ.
// The stale-answer retry is shortened so a test waits for it in real time.
vi.mock('../pages/incarnations/maintenance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../pages/incarnations/maintenance')>();
  return {
    ...mod,
    browserTimeZone: () => 'Europe/Moscow',
    STATUS_REFRESH: { ...mod.STATUS_REFRESH, staleRetryMs: 200 },
  };
});

const BASE = '/v1/incarnations/df-prod';

function permissions(perms: Array<{ resource: string; action: string }>) {
  return { permissions: perms.map((p) => ({ ...p, wildcard: false })) };
}
const READER = permissions([{ resource: 'incarnation', action: 'get' }]);
const WRITER = permissions([
  { resource: 'incarnation', action: 'get' },
  { resource: 'incarnation', action: 'maintenance-set' },
]);

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
const SUNDAY = {
  id: 'w-sun',
  kind: 'weekly',
  days: ['sun'],
  start_time: '10:00',
  duration_minutes: 240,
  timezone: 'Europe/Moscow',
  comment: 'planned maintenance',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T10:00:00Z',
};
const SALE = {
  id: 'f-sale',
  starts_at: '2099-11-19T21:00:00Z',
  ends_at: '2099-12-02T21:00:00Z',
  comment: 'Sale',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T10:00:00Z',
};

const CLOSED = { open_now: false, next_start: '2026-12-09T23:00:00Z' };

function routes(over: { perms?: unknown; windows?: unknown; freezes?: unknown; extra?: FetchRoute[] } = {}): FetchRoute[] {
  return [
    ...(over.extra ?? []),
    { method: 'GET', url: '/v1/me/permissions', body: over.perms ?? WRITER },
    { method: 'GET', url: `${BASE}/maintenance-windows`, body: over.windows ?? { items: [NIGHT, SUNDAY], status: CLOSED } },
    { method: 'GET', url: `${BASE}/freezes`, body: over.freezes ?? { items: [SALE] } },
  ];
}

function sent(method: string, urlPrefix: string): Array<{ url: string; body: unknown }> {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return calls
    .filter(([u, init]) => (init?.method ?? 'GET') === method && u.startsWith(urlPrefix))
    .map(([u, init]) => ({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
}

describe('MaintenanceTab', () => {
  // The status line drops the year inside the current one; a fixed "now" keeps the
  // expectations from expiring on 1 January. Only Date is faked — timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists windows and freezes the way the user drew them, comments as plain text', async () => {
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    const night = await screen.findByTestId('mw-row-w-night');
    expect(night.textContent).toContain('Mon–Fri');
    expect(night.textContent).toContain('02:00–05:00');
    expect(night.textContent).toContain('Europe/Moscow');
    expect(within(night).getByText('night works')).toBeInTheDocument();
    expect(screen.getByTestId('mw-row-w-sun').textContent).toContain('10:00–14:00');

    const sale = await screen.findByTestId('freeze-row-f-sale');
    expect(sale.textContent).toContain('20.11.2099 – 02.12.2099');
    expect(within(sale).getByText('Sale')).toBeInTheDocument();
    expect(sale.textContent).toContain('upcoming');
  });

  // The status block, one test per state (NIM-1135). The instants are the
  // mockup's own: Friday 30.10 00:50 in Moscow, a Mon–Fri 02:00–05:00 window and
  // a whole-day freeze over 31.10–01.11.
  describe('status block', () => {
    const FRI_0050 = new Date('2026-10-29T21:50:00Z');
    const FRI_0200 = '2026-10-29T23:00:00Z';
    const WEEKEND_SALE = { ...SALE, starts_at: '2026-10-30T21:00:00Z', ends_at: '2026-11-01T21:00:00Z' };

    async function block() {
      const el = await screen.findByTestId('mw-status');
      return {
        state: el.getAttribute('data-state'),
        title: within(el).getByTestId('mw-status-title').textContent,
        sub: within(el).queryByTestId('mw-status-sub')?.textContent ?? '',
        ahead: within(el).queryByTestId('mw-status-freeze-ahead')?.textContent ?? null,
        zone: within(el).getByTestId('mw-status-zone').textContent,
      };
    }

    it('closed: when it opens, how long until then, and the comment of the window that opens', async () => {
      vi.setSystemTime(FRI_0050);
      installFetchMock(
        routes({
          windows: { items: [NIGHT, SUNDAY], status: { open_now: false, next_start: FRI_0200 } },
          freezes: { items: [WEEKEND_SALE] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toEqual({
        state: 'closed',
        title: 'Closed',
        sub: 'Opens Fri 30.10 at 02:00 · in 1 h 10 min · night works',
        ahead: 'Freeze ahead: Sale, 31.10 – 01.11',
        zone: "times in your browser's zone Europe/Moscow",
      });
    });

    it('open: until when, and the comment of the window it is open in', async () => {
      vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
      installFetchMock(
        routes({
          windows: { items: [NIGHT, SUNDAY], status: { open_now: true, next_start: '2026-10-30T00:00:00Z' } },
          freezes: { items: [] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toMatchObject({ state: 'open', title: 'Open', sub: 'until 05:00 · night works', ahead: null });
    });

    it('open: a slot past midnight names the day it ends on, and a freeze ahead cuts the stretch short', async () => {
      const allDay = { ...NIGHT, id: 'w-all', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start_time: '00:00', duration_minutes: 1440, comment: 'any day' };
      vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
      installFetchMock(
        routes({
          windows: { items: [allDay], status: { open_now: true, next_start: '2026-10-30T00:00:00Z' } },
          freezes: { items: [WEEKEND_SALE] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toMatchObject({ state: 'open', sub: 'until Sat 31.10 00:00 · any day' });
    });

    it('open: slots that run on for over a week with no freeze ahead have no end to name', async () => {
      const allDay = { ...NIGHT, id: 'w-all', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start_time: '00:00', duration_minutes: 1440, comment: '' };
      vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
      installFetchMock(
        routes({
          windows: { items: [allDay], status: { open_now: true, next_start: '2026-10-30T00:00:00Z' } },
          freezes: { items: [] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toMatchObject({ state: 'open', sub: 'no break for over a week' });
    });

    it('freeze: until when, its comment, and that an operator needs consent', async () => {
      vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
      installFetchMock(
        routes({
          windows: {
            items: [NIGHT],
            status: { open_now: false, next_start: '2026-11-01T23:00:00Z', active_freeze: WEEKEND_SALE },
          },
          freezes: { items: [WEEKEND_SALE] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toMatchObject({
        state: 'frozen',
        title: 'Freeze until Mon 02.11 00:00',
        sub: "Sale · an operator's run needs consent",
        ahead: null,
      });
      expect(within(screen.getByTestId('freeze-row-f-sale')).getByText('in force')).toBeInTheDocument();
    });

    it('no windows: always open outside a freeze, and a freeze ahead is still shown', async () => {
      vi.setSystemTime(FRI_0050);
      installFetchMock(
        routes({
          windows: { items: [], status: { open_now: true, next_start: FRI_0050.toISOString() } },
          freezes: { items: [WEEKEND_SALE] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await screen.findByTestId('mw-empty')).toBeInTheDocument();
      expect(await block()).toMatchObject({
        state: 'always',
        title: 'Always open',
        sub: 'no windows — a run may start at any time outside a freeze',
        ahead: 'Freeze ahead: Sale, 31.10 – 01.11',
      });
    });

    it('freeze: a freeze another one picks up from is not shown as the end', async () => {
      const next = { ...WEEKEND_SALE, id: 'f-next', comment: 'Audit', starts_at: '2026-11-01T21:00:00Z', ends_at: '2026-11-04T21:00:00Z' };
      vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
      installFetchMock(
        routes({
          windows: { items: [NIGHT], status: { open_now: false, next_start: '2026-11-05T23:00:00Z', active_freeze: WEEKEND_SALE } },
          freezes: { items: [WEEKEND_SALE, next] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      // The chip does not repeat a freeze the title already spans.
      expect(await block()).toMatchObject({ state: 'frozen', title: 'Freeze until Thu 05.11 00:00', ahead: null });
    });

    // Timing tests: Date is pinned just before the change and then moved past it, as
    // the clock would; the timeouts are real. The windows endpoint answers in turn,
    // the last answer repeating.
    // Returns the count of asks; `askedAt` holds when each was made (performance.now,
    // which the pinned Date does not touch).
    let askedAt: number[] = [];
    function answersInTurn(statuses: unknown[], freezes: unknown[] = [], items: unknown[] = [NIGHT]): () => number {
      installFetchMock(routes({ windows: { items, status: statuses[0] }, freezes: { items: freezes } }));
      const answer = globalThis.fetch;
      askedAt = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (!String(input).startsWith(`${BASE}/maintenance-windows`)) return answer(input, init);
          const status = statuses[Math.min(askedAt.length, statuses.length - 1)];
          askedAt.push(performance.now());
          return new Response(JSON.stringify({ items, status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }),
      );
      return () => askedAt.length;
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const stateIs = (s: string) =>
      waitFor(() => expect(screen.getByTestId('mw-status').getAttribute('data-state')).toBe(s), { timeout: 4000 });
    const CLOSED_TILL_2 = { open_now: false, next_start: FRI_0200 };
    const OPEN_AT_2 = { open_now: true, next_start: '2026-10-29T23:00:01Z' };

    it('the status is asked again a second after the instant it was due to change, and read at that time', async () => {
      vi.setSystemTime(new Date('2026-10-29T22:59:59.500Z'));
      const asked = answersInTurn([CLOSED_TILL_2, OPEN_AT_2]);
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await block()).state).toBe('closed');
      vi.setSystemTime(new Date('2026-10-29T23:00:01Z'));
      await sleep(900);
      expect(asked()).toBe(1);

      await stateIs('open');
      expect(await block()).toMatchObject({ title: 'Open', sub: 'until 05:00 · night works' });
      expect(asked()).toBe(2);
    });

    it('an answer late to change is asked for again: closed past its opening', async () => {
      vi.setSystemTime(new Date('2026-10-29T22:59:59.500Z'));
      const asked = answersInTurn([CLOSED_TILL_2, CLOSED_TILL_2, OPEN_AT_2]);
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await block()).state).toBe('closed');
      vi.setSystemTime(new Date('2026-10-29T23:00:01Z'));
      await stateIs('open');
      expect(asked()).toBe(3);
      // Not at once: the retry waits its interval, shortened to 200 ms here. A slow
      // machine can only make the gap longer.
      expect(askedAt[2] - askedAt[1]).toBeGreaterThanOrEqual(150);
    });

    it('a freeze ending into a closed answer is a new answer, not an old one to retry', async () => {
      const sale = { ...WEEKEND_SALE, starts_at: '2026-10-29T20:00:00Z', ends_at: '2026-10-29T23:00:00Z' };
      vi.setSystemTime(new Date('2026-10-29T22:59:59.500Z'));
      const nextNight = '2026-10-30T23:00:00Z';
      const asked = answersInTurn(
        [
          { open_now: false, next_start: nextNight, active_freeze: sale },
          { open_now: false, next_start: nextNight },
        ],
        [sale],
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await block()).state).toBe('frozen');
      vi.setSystemTime(new Date('2026-10-29T23:00:01Z'));
      await stateIs('closed');
      await sleep(600);
      expect(asked()).toBe(2);
    });

    it('an answer late to change is asked for again: open past the end of its window', async () => {
      vi.setSystemTime(new Date('2026-10-30T01:59:59.500Z'));
      const asked = answersInTurn([
        { open_now: true, next_start: '2026-10-30T01:59:59.500Z' },
        { open_now: true, next_start: '2026-10-30T02:00:01Z' },
        { open_now: false, next_start: '2026-10-30T23:00:00Z' },
      ]);
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toMatchObject({ state: 'open', sub: 'until 05:00 · night works' });
      vi.setSystemTime(new Date('2026-10-30T02:00:01Z'));
      await stateIs('closed');
      expect(asked()).toBe(3);
    });

    it('[GUARD] an answer that stays old is asked for again for a minute at most', async () => {
      vi.setSystemTime(new Date('2026-10-29T22:59:59.500Z'));
      const asked = answersInTurn([CLOSED_TILL_2]);
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await block()).state).toBe('closed');
      vi.setSystemTime(new Date('2026-10-29T23:01:30Z'));
      await waitFor(() => expect(asked()).toBe(2), { timeout: 4000 });
      await sleep(1000);
      expect(asked()).toBe(2);
    }, 10_000);

    it('past the retry minute (a laptop asleep) the instant is worked out again from the new answer', async () => {
      const first = { ...WEEKEND_SALE, id: 'f1', starts_at: '2026-10-29T23:00:00Z', ends_at: '2026-10-29T23:00:30Z' };
      const second = { ...WEEKEND_SALE, id: 'f2', starts_at: '2026-10-29T23:01:45.300Z', ends_at: '2026-10-29T23:10:00Z' };
      vi.setSystemTime(new Date('2026-10-29T22:59:59.500Z'));
      const asked = answersInTurn(
        [
          { open_now: true, next_start: '2026-10-29T22:59:59.500Z' },
          { open_now: true, next_start: '2026-10-29T23:01:45Z' },
        ],
        [first, second],
        [],
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await block()).state).toBe('always');
      // Woken past the first freeze and its retry minute: the next ask is due at the second.
      vi.setSystemTime(new Date('2026-10-29T23:01:45Z'));
      await waitFor(() => expect(asked()).toBe(3), { timeout: 4000 });
    }, 10_000);

    it('a freeze whose end does not parse is shown as the server wrote it', async () => {
      const broken = { ...WEEKEND_SALE, ends_at: 'soon' };
      installFetchMock(
        routes({
          windows: { items: [NIGHT], status: { open_now: false, next_start: FRI_0200, active_freeze: broken } },
          freezes: { items: [] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect(await block()).toMatchObject({ state: 'frozen', title: 'Freeze until soon' });
    });

    it('[GUARD] the status block comes first: right under the heading, before both lists', async () => {
      installFetchMock(routes());
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      const status = await screen.findByTestId('mw-status');
      const tab = screen.getByTestId('maintenance-tab');
      const heading = within(tab).getByRole('heading', { level: 2 });
      expect(heading.parentElement?.nextElementSibling).toBe(status);
      const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(precedes(status, await screen.findByTestId('mw-table'))).toBe(true);
      expect(precedes(status, await screen.findByTestId('freeze-table'))).toBe(true);
    });
  });

  it('[GUARD] no comment on the tab is wrapped in quotes', async () => {
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
    const weekendSale = { ...SALE, starts_at: '2026-10-30T21:00:00Z', ends_at: '2026-11-01T21:00:00Z' };
    const blackFriday = { ...SALE, id: 'f-bf', comment: 'Black Friday', starts_at: '2026-11-19T21:00:00Z', ends_at: '2026-12-02T21:00:00Z' };
    installFetchMock(
      routes({
        windows: {
          items: [NIGHT, SUNDAY],
          status: { open_now: false, next_start: '2026-11-01T23:00:00Z', active_freeze: weekendSale },
        },
        freezes: { items: [weekendSale, blackFriday] },
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await screen.findByTestId('freeze-row-f-bf');
    expect(screen.getByTestId('mw-status-sub').textContent).toContain('Sale');
    expect(screen.getByTestId('mw-status-freeze-ahead').textContent).toContain('Black Friday');
    await user.click(screen.getByTestId('freeze-delete-f-sale'));
    expect(document.body.textContent).toContain('31.10.2026 – 01.11.2026 · Sale');

    const text = document.body.textContent ?? '';
    for (const comment of ['night works', 'planned maintenance', 'Sale', 'Black Friday']) {
      expect(text).toContain(comment);
      expect(text).not.toMatch(new RegExp(`[«»“”„"'‘’]\\s*${comment}|${comment}\\s*[«»“”„"'‘’]`));
    }
  });

  it('without incarnation.maintenance-set every write control is hidden', async () => {
    installFetchMock(routes({ perms: READER }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    await screen.findByTestId('mw-row-w-night');
    await waitFor(() => expect(screen.queryByTestId('mw-add')).not.toBeInTheDocument());
    expect(screen.queryByTestId('mw-copy-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freeze-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mw-edit-w-night')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mw-delete-w-night')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freeze-edit-f-sale')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freeze-delete-f-sale')).not.toBeInTheDocument();
  });

  it('adds a window: the end time becomes a duration on the wire', async () => {
    installFetchMock(routes({ extra: [{ method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-add'));
    await user.click(screen.getByTestId('mw-add-weekly'));
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) await user.click(screen.getByTestId(`mw-day-${d}`));
    const start = screen.getByTestId('mw-start');
    await user.clear(start);
    await user.type(start, '22:00');
    const end = screen.getByTestId('mw-end');
    await user.clear(end);
    await user.type(end, '02:30');
    const tz = screen.getByTestId('mw-timezone');
    await user.clear(tz);
    await user.type(tz, 'Europe/Moscow');
    await user.type(screen.getByTestId('mw-comment'), 'night works');
    expect(screen.getByTestId('mw-duration-hint').textContent).toContain('Crosses midnight');
    await user.click(screen.getByTestId('mw-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(1));
    expect(sent('POST', `${BASE}/maintenance-windows`)[0].body).toEqual({
      kind: 'weekly',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      start_time: '22:00',
      duration_minutes: 270,
      timezone: 'Europe/Moscow',
      comment: 'night works',
    });
  });

  it('refuses a window with no day and an unknown zone before asking the server', async () => {
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-add'));
    await user.click(screen.getByTestId('mw-add-weekly'));
    const tz = screen.getByTestId('mw-timezone');
    await user.clear(tz);
    await user.type(tz, 'Mars/Olympus');
    await user.click(screen.getByTestId('mw-submit'));

    expect(await screen.findByText('Pick at least one day.')).toBeInTheDocument();
    expect(screen.getByText(/Unknown time zone/)).toBeInTheDocument();
    expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(0);
  });

  it('edits a window with PUT and the row\'s own values as the start', async () => {
    installFetchMock(routes({ extra: [{ method: 'PUT', url: `${BASE}/maintenance-windows/w-sun`, body: SUNDAY }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-edit-w-sun'));
    expect((screen.getByTestId('mw-end') as HTMLInputElement).value).toBe('14:00');
    await user.click(screen.getByTestId('mw-day-sat'));
    await user.click(screen.getByTestId('mw-submit'));

    await waitFor(() => expect(sent('PUT', `${BASE}/maintenance-windows/w-sun`)).toHaveLength(1));
    expect(sent('PUT', `${BASE}/maintenance-windows/w-sun`)[0].body).toMatchObject({
      days: ['sat', 'sun'],
      start_time: '10:00',
      duration_minutes: 240,
    });
  });

  it('deletes a window after confirmation, and the dialog closes', async () => {
    installFetchMock(routes({ extra: [{ method: 'DELETE', url: `${BASE}/maintenance-windows/w-night`, status: 204 }] }));
    // The answer arrives after the pending render, as it does over a network: a
    // success callback that closes only when nothing is pending then sees "pending".
    const answer = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'DELETE') await new Promise((r) => setTimeout(r, 30));
        return answer(input, init);
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-delete-w-night'));
    expect(sent('DELETE', BASE)).toHaveLength(0);
    await user.click(screen.getByTestId('maintenance-delete-confirm'));
    await waitFor(() => expect(sent('DELETE', `${BASE}/maintenance-windows/w-night`)).toHaveLength(1));
    // The modal closes only on success; a 204 the client choked on would leave it open.
    await waitFor(() => expect(screen.queryByTestId('maintenance-delete-confirm')).not.toBeInTheDocument());
  });

  it('adds a whole-day freeze: the last day is inclusive, the wire end exclusive', async () => {
    installFetchMock(routes({ extra: [{ method: 'POST', url: `${BASE}/freezes`, status: 201, body: SALE }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-add'));
    const s = screen.getByTestId('freeze-start-date');
    await user.clear(s);
    await user.type(s, '2026-11-20');
    const e = screen.getByTestId('freeze-end-date');
    await user.clear(e);
    await user.type(e, '2026-12-02');
    await user.type(screen.getByTestId('freeze-comment'), 'Sale');
    await user.click(screen.getByTestId('freeze-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/freezes`)).toHaveLength(1));
    // Midnight in the browser zone (pinned to Moscow), not in the runner's.
    expect(sent('POST', `${BASE}/freezes`)[0].body).toEqual({
      starts_at: '2026-11-19T21:00:00.000Z',
      ends_at: '2026-12-02T21:00:00.000Z',
      comment: 'Sale',
    });
  });

  it('unticking «Whole days» on an edited freeze keeps its end, it does not lose a day', async () => {
    installFetchMock(routes({ extra: [{ method: 'PUT', url: `${BASE}/freezes/f-sale`, body: SALE }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-edit-f-sale'));
    expect((screen.getByTestId('freeze-end-date') as HTMLInputElement).value).toBe('2099-12-02');
    await user.click(screen.getByTestId('freeze-whole-days'));
    expect((screen.getByTestId('freeze-end-date') as HTMLInputElement).value).toBe('2099-12-03');
    expect((screen.getByTestId('freeze-end-time') as HTMLInputElement).value).toBe('00:00');
    await user.click(screen.getByTestId('freeze-submit'));

    await waitFor(() => expect(sent('PUT', `${BASE}/freezes/f-sale`)).toHaveLength(1));
    expect(sent('PUT', `${BASE}/freezes/f-sale`)[0].body).toMatchObject({
      starts_at: '2099-11-19T21:00:00.000Z',
      ends_at: '2099-12-02T21:00:00.000Z',
    });
  });

  it('refuses a freeze that ends before it starts', async () => {
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-add'));
    await user.click(screen.getByTestId('freeze-whole-days'));
    const s = screen.getByTestId('freeze-start-date');
    await user.clear(s);
    await user.type(s, '2026-11-20');
    const e = screen.getByTestId('freeze-end-date');
    await user.clear(e);
    await user.type(e, '2026-11-20');
    const st = screen.getByTestId('freeze-start-time');
    await user.clear(st);
    await user.type(st, '18:00');
    const et = screen.getByTestId('freeze-end-time');
    await user.clear(et);
    await user.type(et, '10:00');
    await user.click(screen.getByTestId('freeze-submit'));

    expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument();
    expect(sent('POST', `${BASE}/freezes`)).toHaveLength(0);
  });

  it('past freezes stay out of the list until asked for', async () => {
    const past = { ...SALE, id: 'f-old', starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-02T00:00:00Z', comment: 'old' };
    installFetchMock(routes({ freezes: { items: [past, SALE] } }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await screen.findByTestId('freeze-row-f-sale');
    expect(screen.queryByTestId('freeze-row-f-old')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('freeze-toggle-past'));
    expect(screen.getByTestId('freeze-row-f-old').textContent).toContain('past');
  });

  it('copies windows from another incarnation, one POST per source window', async () => {
    installFetchMock(
      routes({
        windows: { items: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } },
        extra: [
          { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
          { method: 'GET', url: '/v1/incarnations/df-stage/maintenance-windows', body: { items: [NIGHT, SUNDAY], status: CLOSED } },
          { method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT },
        ],
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-copy-open'));
    await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
    await user.click(screen.getByTestId('mw-copy-load'));
    const preview = await screen.findByTestId('mw-copy-preview');
    expect(preview.textContent).toContain('Mon–Fri');
    expect(within(preview).getByText('night works')).toBeInTheDocument();
    expect(within(preview).getByText('planned maintenance')).toBeInTheDocument();
    await user.click(screen.getByTestId('mw-copy-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(2));
    expect(sent('POST', `${BASE}/maintenance-windows`).map((c) => c.body)).toEqual([
      { kind: 'weekly', days: NIGHT.days, start_time: '02:00', duration_minutes: 180, timezone: 'Europe/Moscow', comment: 'night works' },
      { kind: 'weekly', days: SUNDAY.days, start_time: '10:00', duration_minutes: 240, timezone: 'Europe/Moscow', comment: 'planned maintenance' },
    ]);
  });

  it('copy with "replace" creates the new windows before it removes the old ones', async () => {
    installFetchMock(
      routes({
        windows: { items: [SUNDAY], status: CLOSED },
        extra: [
          { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
          { method: 'GET', url: '/v1/incarnations/df-stage/maintenance-windows', body: { items: [NIGHT], status: CLOSED } },
          { method: 'DELETE', url: `${BASE}/maintenance-windows/w-sun`, status: 204 },
          { method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT },
        ],
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-copy-open'));
    await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
    await user.click(screen.getByTestId('mw-copy-load'));
    await user.click(await screen.findByTestId('mw-copy-replace'));
    await user.click(screen.getByTestId('mw-copy-submit'));

    await waitFor(() => expect(sent('DELETE', `${BASE}/maintenance-windows/w-sun`)).toHaveLength(1));
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
    const order = calls.filter(([, i]) => i?.method === 'POST' || i?.method === 'DELETE').map(([, i]) => i?.method);
    expect(order).toEqual(['POST', 'DELETE']);
  });

  it('a failed create during "replace" leaves the old windows and says so', async () => {
    installFetchMock(
      routes({
        windows: { items: [SUNDAY], status: CLOSED },
        extra: [
          { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
          { method: 'GET', url: '/v1/incarnations/df-stage/maintenance-windows', body: { items: [NIGHT], status: CLOSED } },
          { method: 'POST', url: `${BASE}/maintenance-windows`, status: 422, body: { title: 'Unprocessable', detail: 'too many windows' } },
        ],
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-copy-open'));
    await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
    await user.click(screen.getByTestId('mw-copy-load'));
    await user.click(await screen.findByTestId('mw-copy-replace'));
    await user.click(screen.getByTestId('mw-copy-submit'));

    expect(await screen.findByText(/creating 0 of 1 windows and removing 0 of 1 old ones/)).toBeInTheDocument();
    expect(sent('DELETE', BASE)).toHaveLength(0);
  });

  it('a Keeper without the endpoint degrades to a note, not a crash', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: WRITER },
      { method: 'GET', url: `${BASE}/maintenance-windows`, status: 404, body: { title: 'Not Found' } },
      { method: 'GET', url: `${BASE}/freezes`, status: 404, body: { title: 'Not Found' } },
    ]);
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    expect(await screen.findByTestId('maintenance-degraded')).toBeInTheDocument();
  });

  // The calendar and the one-off windows (NIM-1136). "Now" is the mockup's: Friday
  // 30.10 00:50 in Moscow, so the week on screen is 26.10–01.11.
  describe('calendar and one-off windows', () => {
    const FRI_0050 = new Date('2026-10-29T21:50:00Z');
    const CLOSED_TILL_FRI_2 = { open_now: false, next_start: '2026-10-29T23:00:00Z' };
    const SAT_LATE = { ...NIGHT, id: 'w-sat', days: ['sat'], start_time: '22:00', duration_minutes: 240, comment: 'weekend' };
    const WEEKEND_SALE = { ...SALE, starts_at: '2026-10-30T21:00:00Z', ends_at: '2026-11-01T21:00:00Z' };
    const once = (id: string, startsAt: string, endsAt: string, comment: string) => ({
      id,
      kind: 'once',
      starts_at: startsAt,
      ends_at: endsAt,
      comment,
      created_at: '2026-10-27T10:00:00Z',
      updated_at: '2026-10-27T10:00:00Z',
    });
    // Fri 30.10 20:00–23:00 in Moscow.
    const MIGRATION = once('o-mig', '2026-10-30T17:00:00Z', '2026-10-30T20:00:00Z', 'database migration');
    // Tue 27.10 20:00–21:00 in Moscow: over by now.
    const PAST_ONCE = once('o-past', '2026-10-27T17:00:00Z', '2026-10-27T18:00:00Z', 'hotfix');

    beforeEach(() => vi.setSystemTime(FRI_0050));

    function marks(date: string) {
      const row = screen.getByTestId(`mw-cal-day-${date}`);
      return Array.from(row.querySelectorAll<HTMLElement>('[data-testid="mw-cal-mark"]')).map((el) => ({
        kind: el.dataset.kind,
        ref: el.dataset.ref,
        at: `${parseFloat(el.style.left).toFixed(2)}+${parseFloat(el.style.width).toFixed(2)}`,
        text: el.textContent,
      }));
    }

    it('[GUARD] a slot across midnight is drawn on both days, in the browser zone', async () => {
      installFetchMock(routes({ windows: { items: [SAT_LATE], status: CLOSED_TILL_FRI_2 }, freezes: { items: [] } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      await screen.findByTestId('mw-calendar');
      // Sat 22:00 for 4 h: 22:00–24:00 on Saturday's row, 00:00–02:00 on Sunday's.
      expect(marks('2026-10-31')).toEqual([{ kind: 'weekly', ref: 'w-sat', at: '91.67+8.33', text: 'weekend' }]);
      expect(marks('2026-11-01')).toEqual([{ kind: 'weekly', ref: 'w-sat', at: '0.00+8.33', text: '' }]);
      expect(marks('2026-10-30')).toEqual([]);
    });

    it('[GUARD] a freeze cuts the windows it covers: struck through under the hatch, not drawn open', async () => {
      installFetchMock(
        routes({
          windows: { items: [NIGHT, SUNDAY, SAT_LATE], status: CLOSED_TILL_FRI_2 },
          freezes: { items: [WEEKEND_SALE] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      await screen.findByTestId('mw-calendar');
      expect(marks('2026-10-30')).toEqual([{ kind: 'weekly', ref: 'w-night', at: '8.33+12.50', text: 'night works' }]);
      expect(marks('2026-10-31')).toEqual([
        // Under the freeze's own words the cancelled slot says nothing; its title still does.
        { kind: 'cut', ref: 'w-sat', at: '91.67+8.33', text: '' },
        { kind: 'freeze', ref: 'f-sale', at: '0.00+100.00', text: 'freeze · Sale' },
      ]);
      expect(marks('2026-11-01')).toEqual([
        { kind: 'cut', ref: 'w-sat', at: '0.00+8.33', text: '' },
        { kind: 'cut', ref: 'w-sun', at: '41.67+16.67', text: 'planned maintenance' },
        { kind: 'freeze', ref: 'f-sale', at: '0.00+100.00', text: '' },
      ]);
    });

    it('a one-off window is drawn in its own cell, dashed, and the week shows past days muted with the now line', async () => {
      installFetchMock(routes({ windows: { items: [NIGHT, MIGRATION], status: CLOSED_TILL_FRI_2 }, freezes: { items: [] } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      await screen.findByTestId('mw-calendar');
      expect(marks('2026-10-30')).toEqual([
        { kind: 'weekly', ref: 'w-night', at: '8.33+12.50', text: 'night works' },
        { kind: 'once', ref: 'o-mig', at: '83.33+12.50', text: 'database migration' },
      ]);
      for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-31', '2026-11-01']) {
        expect(marks(d).filter((m) => m.kind === 'once')).toEqual([]);
      }
      expect(screen.getByTestId('mw-cal-range').textContent).toBe('26 October – 1 November 2026');
      expect(screen.getByTestId('mw-cal-day-2026-10-29').dataset.past).toBe('true');
      expect(screen.getByTestId('mw-cal-day-2026-10-30').dataset.past).toBeUndefined();
      const today = screen.getByTestId('mw-cal-day-2026-10-30');
      expect(today.dataset.today).toBe('true');
      expect(within(today).getByTestId('mw-cal-now').textContent).toBe('now 00:50');
      expect(screen.getByTestId('mw-cal-zone').textContent).toBe('browser zone Europe/Moscow · click a block to change it');
    });

    it('[GUARD] a past one-off window does not count and is hidden from its list until asked for', async () => {
      installFetchMock(
        routes({
          windows: { items: [PAST_ONCE], status: { open_now: true, next_start: FRI_0050.toISOString() } },
          freezes: { items: [] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      const status = await screen.findByTestId('mw-status');
      expect(status.getAttribute('data-state')).toBe('always');
      expect(screen.getByTestId('mw-once-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('mw-once-row-o-past')).not.toBeInTheDocument();
      const toggle = screen.getByTestId('mw-once-toggle-past');
      expect(toggle.textContent).toBe('Show past windows (1)');
      await user.click(toggle);
      expect(screen.getByTestId('mw-once-row-o-past').textContent).toContain('27.10 20:00 – 21:00');
    });

    it('the one-off list shows what is ahead, ordered by start', async () => {
      const later = once('o-later', '2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z', 'later');
      installFetchMock(routes({ windows: { items: [later, NIGHT, MIGRATION, PAST_ONCE], status: CLOSED_TILL_FRI_2 } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      const table = await screen.findByTestId('mw-once-table');
      const rows = within(table).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid'));
      expect(rows).toEqual(['mw-once-row-o-mig', 'mw-once-row-o-later']);
      expect(screen.getByTestId('mw-once-row-o-mig').textContent).toContain('30.10 20:00 – 23:00');
      // Weekly windows only in their own list.
      expect(within(screen.getByTestId('mw-table')).queryByText('database migration')).not.toBeInTheDocument();
    });

    it('[GUARD] source default: the status block says so, the calendar draws the defaults, and the list is read-only', async () => {
      const clusterNights = {
        kind: 'weekly',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        start_time: '02:00',
        duration_minutes: 180,
        timezone: 'Europe/Moscow',
        comment: 'cluster nights',
      };
      installFetchMock(
        routes({
          windows: { items: [], defaults: [clusterNights], status: { ...CLOSED_TILL_FRI_2, source: 'default' } },
          freezes: { items: [] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      const status = await screen.findByTestId('mw-status');
      expect(status.getAttribute('data-state')).toBe('closed');
      expect(within(status).getByTestId('mw-status-sub').textContent).toBe('Opens Fri 30.10 at 02:00 · in 1 h 10 min · cluster nights');
      expect(within(status).getByTestId('mw-status-default').textContent).toBe('cluster default windows');

      expect(marks('2026-10-30')).toEqual([{ kind: 'default', ref: 'default', at: '8.33+12.50', text: 'cluster nights' }]);
      // A default is set in Keeper's settings: its block opens no form.
      expect(screen.getByTestId('mw-cal-day-2026-10-30').querySelector('button[data-testid="mw-cal-mark"]')).toBeNull();

      const table = screen.getByTestId('mw-defaults-table');
      expect(within(table).getByTestId('mw-default-row-0').textContent).toContain('Mon–Fri');
      expect(within(table).queryAllByRole('button')).toEqual([]);
      expect(screen.getByTestId('mw-defaults-note').textContent).toContain('maintenance.default_windows');
      expect(screen.queryByTestId('mw-empty')).not.toBeInTheDocument();
    });

    it('no cluster default: an incarnation without windows is always open, with no default marks', async () => {
      installFetchMock(
        routes({
          windows: { items: [], status: { open_now: true, next_start: FRI_0050.toISOString(), source: 'none' } },
          freezes: { items: [] },
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await screen.findByTestId('mw-status')).getAttribute('data-state')).toBe('always');
      expect(screen.queryByTestId('mw-status-default')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mw-defaults-table')).not.toBeInTheDocument();
      expect(screen.getByTestId('mw-empty')).toBeInTheDocument();
    });

    it('steps through weeks, back to today, and into a month grid of whole weeks', async () => {
      installFetchMock(routes({ windows: { items: [NIGHT, MIGRATION], status: CLOSED_TILL_FRI_2 }, freezes: { items: [WEEKEND_SALE] } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      const range = await screen.findByTestId('mw-cal-range');
      await user.click(screen.getByTestId('mw-cal-next'));
      expect(range.textContent).toBe('2 – 8 November 2026');
      expect(marks('2026-11-02')).toEqual([{ kind: 'weekly', ref: 'w-night', at: '8.33+12.50', text: 'night works' }]);
      await user.click(screen.getByTestId('mw-cal-today'));
      expect(range.textContent).toBe('26 October – 1 November 2026');

      await user.click(screen.getByTestId('mw-cal-month'));
      expect(screen.getByTestId('mw-calendar').dataset.view).toBe('month');
      expect(range.textContent).toBe('October 2026');
      // Monday 28.09 to Sunday 01.11: five whole weeks.
      expect(screen.getByTestId('mw-cal-day-2026-09-28')).toBeInTheDocument();
      expect(screen.getByTestId('mw-cal-day-2026-11-01')).toBeInTheDocument();
      expect(screen.queryByTestId('mw-cal-day-2026-11-02')).not.toBeInTheDocument();
      // The same marks in a day's cell, and the one-off window and freeze by name.
      expect(marks('2026-10-30').map((m) => m.kind)).toEqual(['weekly', 'once']);
      expect(screen.getByTestId('mw-cal-day-2026-10-30').textContent).toContain('database migration');
      expect(screen.getByTestId('mw-cal-day-2026-10-31').textContent).toContain('freeze · Sale');
      await user.click(screen.getByTestId('mw-cal-prev'));
      expect(range.textContent).toBe('September 2026');
    });

    it('a click on a block opens its own edit form; a reader gets no clickable blocks', async () => {
      installFetchMock(routes({ windows: { items: [NIGHT, MIGRATION], status: CLOSED_TILL_FRI_2 }, freezes: { items: [WEEKEND_SALE] } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await screen.findByTestId('mw-calendar');
      const fri = screen.getByTestId('mw-cal-day-2026-10-30');
      await user.click(fri.querySelector<HTMLElement>('[data-kind="once"]')!);
      expect((screen.getByTestId('mw-once-start-date') as HTMLInputElement).value).toBe('2026-10-30');
      expect((screen.getByTestId('mw-once-start-time') as HTMLInputElement).value).toBe('20:00');
      expect((screen.getByTestId('mw-once-end-time') as HTMLInputElement).value).toBe('23:00');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByTestId('mw-once-start-date')).not.toBeInTheDocument());

      await user.click(fri.querySelector<HTMLElement>('[data-kind="weekly"]')!);
      expect((screen.getByTestId('mw-start') as HTMLInputElement).value).toBe('02:00');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByTestId('mw-start')).not.toBeInTheDocument());

      await user.click(screen.getByTestId('mw-cal-day-2026-10-31').querySelector<HTMLElement>('[data-kind="freeze"]')!);
      expect((screen.getByTestId('freeze-start-date') as HTMLInputElement).value).toBe('2026-10-31');
    });

    it('a block is named in full for a reader that cannot hover: kind, days, time, zone, comment', async () => {
      installFetchMock(routes({ windows: { items: [NIGHT, MIGRATION], status: CLOSED_TILL_FRI_2 }, freezes: { items: [WEEKEND_SALE] } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      await screen.findByTestId('mw-calendar');
      const fri = screen.getByTestId('mw-cal-day-2026-10-30');
      expect(within(fri).getByRole('button', { name: 'Weekly window · Mon–Fri 02:00–05:00 Europe/Moscow · night works' })).toBeInTheDocument();
      expect(within(fri).getByRole('button', { name: 'One-off window · 30.10 20:00 – 23:00 · database migration' })).toBeInTheDocument();
      expect(
        within(screen.getByTestId('mw-cal-day-2026-10-31')).getByRole('button', { name: 'Freeze · 31.10.2026 – 01.11.2026 · Sale' }),
      ).toBeInTheDocument();
    });

    it('in a month the day strips are not targets; a note opens its form and the date opens its week', async () => {
      installFetchMock(routes({ windows: { items: [NIGHT, MIGRATION], status: CLOSED_TILL_FRI_2 }, freezes: { items: [WEEKEND_SALE] } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-cal-month'));
      expect(screen.getByTestId('mw-calendar').querySelectorAll('button[data-testid="mw-cal-mark"]')).toHaveLength(0);
      expect(screen.getByTestId('mw-cal-zone').textContent).toBe(
        'browser zone Europe/Moscow · click a date for its week, a name to change it',
      );
      const fri = screen.getByTestId('mw-cal-day-2026-10-30');
      await user.click(within(fri).getByRole('button', { name: /database migration/ }));
      expect((screen.getByTestId('mw-once-start-time') as HTMLInputElement).value).toBe('20:00');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByTestId('mw-once-start-time')).not.toBeInTheDocument());

      await user.click(within(screen.getByTestId('mw-cal-day-2026-10-12')).getByRole('button', { name: 'Open the week of Mon 12.10' }));
      expect(screen.getByTestId('mw-calendar').dataset.view).toBe('week');
      expect(screen.getByTestId('mw-cal-range').textContent).toBe('12 – 18 October 2026');
    });

    it('without incarnation.maintenance-set the calendar blocks are not buttons', async () => {
      installFetchMock(routes({ perms: READER, windows: { items: [NIGHT, MIGRATION], status: CLOSED_TILL_FRI_2 } }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      await screen.findByTestId('mw-calendar');
      await waitFor(() => expect(screen.queryByTestId('mw-add')).not.toBeInTheDocument());
      expect(screen.getByTestId('mw-calendar').querySelectorAll('button[data-testid="mw-cal-mark"]')).toHaveLength(0);
      expect(screen.getByTestId('mw-cal-zone').textContent).toBe('browser zone Europe/Moscow');
    });

    it('adds a one-off window: «Add window» asks the kind, the form takes a start and an end in the browser zone', async () => {
      installFetchMock(routes({ extra: [{ method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: MIGRATION }] }));
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-add'));
      expect(screen.getByTestId('mw-add-weekly')).toBeInTheDocument();
      await user.click(screen.getByTestId('mw-add-once'));
      const fill = async (id: string, v: string) => {
        const el = screen.getByTestId(id);
        await user.clear(el);
        await user.type(el, v);
      };
      await fill('mw-once-start-date', '2026-10-30');
      await fill('mw-once-start-time', '20:00');
      await fill('mw-once-end-date', '2026-10-30');
      await fill('mw-once-end-time', '23:00');
      await user.type(screen.getByTestId('mw-once-comment'), 'database migration');
      await user.click(screen.getByTestId('mw-once-submit'));

      await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(1));
      expect(sent('POST', `${BASE}/maintenance-windows`)[0].body).toEqual({
        kind: 'once',
        starts_at: '2026-10-30T17:00:00.000Z',
        ends_at: '2026-10-30T20:00:00.000Z',
        comment: 'database migration',
      });
    });

    it('refuses a one-off window that ends before it starts', async () => {
      installFetchMock(routes());
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-add'));
      await user.click(screen.getByTestId('mw-add-once'));
      const end = screen.getByTestId('mw-once-end-date');
      await user.clear(end);
      await user.type(end, '2026-10-01');
      await user.click(screen.getByTestId('mw-once-submit'));

      expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument();
      expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(0);
    });

    it('refuses a new one-off window that has already ended', async () => {
      installFetchMock(routes());
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-add'));
      await user.click(screen.getByTestId('mw-add-once'));
      for (const [id, v] of [
        ['mw-once-start-date', '2026-10-28'],
        ['mw-once-start-time', '20:00'],
        ['mw-once-end-date', '2026-10-28'],
        ['mw-once-end-time', '23:00'],
      ]) {
        const el = screen.getByTestId(id);
        await user.clear(el);
        await user.type(el, v);
      }
      await user.click(screen.getByTestId('mw-once-submit'));

      expect(await screen.findByText(/This end has already passed/)).toBeInTheDocument();
      expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(0);
    });

    it('an edit may keep a past end as it was, but may not set a new one', async () => {
      installFetchMock(
        routes({
          windows: { items: [PAST_ONCE], status: { open_now: true, next_start: FRI_0050.toISOString() } },
          extra: [{ method: 'PUT', url: `${BASE}/maintenance-windows/o-past`, body: PAST_ONCE }],
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-once-toggle-past'));
      await user.click(screen.getByTestId('mw-edit-o-past'));
      const end = screen.getByTestId('mw-once-end-time');
      await user.clear(end);
      await user.type(end, '22:00');
      await user.click(screen.getByTestId('mw-once-submit'));
      expect(await screen.findByText(/This end has already passed/)).toBeInTheDocument();

      await user.clear(end);
      await user.type(end, '21:00');
      await user.type(screen.getByTestId('mw-once-comment'), ' rolled back');
      await user.click(screen.getByTestId('mw-once-submit'));
      await waitFor(() => expect(sent('PUT', `${BASE}/maintenance-windows/o-past`)).toHaveLength(1));
      expect(sent('PUT', `${BASE}/maintenance-windows/o-past`)[0].body).toMatchObject({ ends_at: '2026-10-27T18:00:00.000Z', comment: 'hotfix rolled back' });
    });

    it('Escape closes the add menu even when focus has left its items', async () => {
      installFetchMock(routes());
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-add'));
      act(() => (document.activeElement as HTMLElement).blur());
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('the add menu works from the keyboard: focus on the first kind, arrows move, Escape returns', async () => {
      installFetchMock(routes());
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      const trigger = await screen.findByTestId('mw-add');
      await user.click(trigger);
      expect(screen.getByTestId('mw-add-weekly')).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByTestId('mw-add-once')).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByTestId('mw-add-weekly')).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('edits a one-off window with PUT, its kind kept', async () => {
      installFetchMock(
        routes({
          windows: { items: [MIGRATION], status: CLOSED_TILL_FRI_2 },
          extra: [{ method: 'PUT', url: `${BASE}/maintenance-windows/o-mig`, body: MIGRATION }],
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-edit-o-mig'));
      const end = screen.getByTestId('mw-once-end-time');
      await user.clear(end);
      await user.type(end, '23:30');
      await user.click(screen.getByTestId('mw-once-submit'));

      await waitFor(() => expect(sent('PUT', `${BASE}/maintenance-windows/o-mig`)).toHaveLength(1));
      expect(sent('PUT', `${BASE}/maintenance-windows/o-mig`)[0].body).toEqual({
        kind: 'once',
        starts_at: '2026-10-30T17:00:00.000Z',
        ends_at: '2026-10-30T20:30:00.000Z',
        comment: 'database migration',
      });
    });

    it('[GUARD] copy takes weekly and future one-off windows, never past ones', async () => {
      installFetchMock(
        routes({
          windows: { items: [], status: { open_now: true, next_start: FRI_0050.toISOString() } },
          extra: [
            { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
            {
              method: 'GET',
              url: '/v1/incarnations/df-stage/maintenance-windows',
              body: { items: [NIGHT, PAST_ONCE, MIGRATION], status: CLOSED },
            },
            { method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT },
          ],
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('mw-copy-open'));
      await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
      await user.click(screen.getByTestId('mw-copy-load'));
      const preview = await screen.findByTestId('mw-copy-preview');
      expect(preview.textContent).toContain('30.10 20:00 – 23:00');
      expect(within(preview).queryByText('hotfix')).not.toBeInTheDocument();
      expect(screen.getByTestId('mw-copy-submit').textContent).toBe('Copy windows: 2');
      await user.click(screen.getByTestId('mw-copy-submit'));

      await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(2));
      expect(sent('POST', `${BASE}/maintenance-windows`).map((c) => c.body)).toEqual([
        { kind: 'weekly', days: NIGHT.days, start_time: '02:00', duration_minutes: 180, timezone: 'Europe/Moscow', comment: 'night works' },
        { kind: 'once', starts_at: MIGRATION.starts_at, ends_at: MIGRATION.ends_at, comment: 'database migration' },
      ]);
    });

    // NIM-1153: the user wants the two lists without notes under them. The settings
    // catalog was read only for the number in those notes, so it is not read at all.
    it('[GUARD] the one-off and freeze lists carry no retention note, and the settings are never asked', async () => {
      const PAST_FREEZE = { ...SALE, id: 'f-old', starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-21T00:00:00Z', comment: 'old' };
      installFetchMock(
        routes({
          perms: permissions([
            { resource: 'incarnation', action: 'get' },
            { resource: 'setting', action: 'read' },
          ]),
          windows: { items: [NIGHT, MIGRATION, PAST_ONCE], status: CLOSED_TILL_FRI_2 },
          freezes: { items: [PAST_FREEZE, SALE] },
          extra: [{ method: 'GET', url: '/v1/settings', body: { items: [] } }],
        }),
      );
      renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

      expect((await screen.findByTestId('mw-once-toggle-past')).textContent).toBe('Show past windows (1)');
      expect((await screen.findByTestId('freeze-toggle-past')).textContent).toBe('Show past freezes (1)');
      // The edit buttons are optimistic until the permissions arrive; once they go, a
      // read gated on setting.read would have been sent.
      await waitFor(() => expect(screen.queryByTestId('mw-add')).not.toBeInTheDocument());
      expect(document.querySelector('[data-testid^="mw-retention"]')).toBeNull();
      for (const id of ['mw-once-section', 'freeze-section']) {
        expect(screen.getByTestId(id).textContent).not.toMatch(/retention|deleted|Keeper's settings/);
      }
      expect(sent('GET', '/v1/settings')).toHaveLength(0);
    });
  });
});
