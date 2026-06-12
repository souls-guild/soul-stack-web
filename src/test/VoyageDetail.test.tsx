import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VoyageDetail } from '../pages/voyages/VoyageDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const VOYAGE_ID = '01VAGE0000000000000000001';

const SAMPLE_VOYAGE_SCENARIO = {
  voyage_id: VOYAGE_ID,
  kind: 'scenario',
  scenario_name: 'rolling-restart',
  status: 'succeeded',
  scope_size: 3,
  batch_size: 1,
  concurrency: 50,
  batch_mode: 'barrier',
  on_failure: 'abort',
  dry_run: false,
  total_batches: 3,
  current_batch_index: 3,
  attempt: 1,
  started_by_aid: 'archon-alice',
  created_at: '2026-05-29T10:00:00Z',
  started_at: '2026-05-29T10:00:01Z',
  finished_at: '2026-05-29T10:05:00Z',
  target: { incarnations: ['redis-prod', 'redis-stage'] },
  summary: { total: 3, succeeded: 3, failed: 0, cancelled: 0 },
};

const SAMPLE_VOYAGE_COMMAND = {
  voyage_id: '01VCMD0000000000000000002',
  kind: 'command',
  module: 'core.cmd.shell',
  status: 'running',
  scope_size: 2,
  concurrency: 10,
  batch_mode: 'barrier',
  dry_run: false,
  total_batches: 1,
  current_batch_index: 0,
  attempt: 1,
  started_by_aid: 'archon-bob',
  created_at: '2026-05-29T11:00:00Z',
  started_at: '2026-05-29T11:00:01Z',
  target: { sids: ['host-a.example.com', 'host-b.example.com'] },
};

/** barrier: 10 батчей, выполнено 3 (running) */
const VOYAGE_BARRIER_PARTIAL = {
  ...SAMPLE_VOYAGE_SCENARIO,
  status: 'running',
  total_batches: 10,
  current_batch_index: 3,
  finished_at: undefined,
  summary: undefined,
};

/** barrier: terminal succeeded, 10/10 */
const VOYAGE_BARRIER_TERMINAL = {
  ...SAMPLE_VOYAGE_SCENARIO,
  status: 'succeeded',
  total_batches: 10,
  current_batch_index: 10,
  summary: { total: 10, succeeded: 10, failed: 0, cancelled: 0 },
};

/** window: batch_mode=window, total_batches=1, current_batch_index=0 всегда */
const VOYAGE_WINDOW = {
  ...SAMPLE_VOYAGE_SCENARIO,
  batch_mode: 'window',
  status: 'succeeded',
  scope_size: 5,
  total_batches: 1,
  current_batch_index: 0,
  summary: { total: 5, succeeded: 4, failed: 1, cancelled: 0 },
};

const EMPTY_TARGETS = { voyage_id: VOYAGE_ID, targets: [] };

const SUMMARY_TARGETS = {
  voyage_id: VOYAGE_ID,
  targets: [
    { target_kind: 'incarnation', target_id: 'host-a', batch_index: 0, status: 'succeeded', finished_at: '2026-05-29T10:01:00Z' },
    { target_kind: 'incarnation', target_id: 'host-b', batch_index: 0, status: 'failed', finished_at: '2026-05-29T10:02:00Z' },
    { target_kind: 'incarnation', target_id: 'host-c', batch_index: 1, status: 'succeeded', finished_at: '2026-05-29T10:03:00Z' },
  ],
};

function renderVoyage(id: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/voyages/:id" element={<VoyageDetail />} />
    </Routes>,
    `/voyages/${id}`,
  );
}

describe('VoyageDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
    // @ts-expect-error — EventSource нет в jsdom.
    globalThis.EventSource = class {
      readyState = 0;
      close() { /* noop */ }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });

  it('рендерит scenario-voyage с метаданными и summary', async () => {
    // ВАЖНО: /targets должен идти ДО /voyages/{id} — fetchMock матчит по startsWith.
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });
    expect(screen.getByText('rolling-restart')).toBeInTheDocument();
    expect(screen.getByText('archon-alice')).toBeInTheDocument();
    // Incarnation-ссылки.
    expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();
    // Summary counts.
    expect(screen.getByTestId('voyage-summary-counts')).toBeInTheDocument();
    expect(screen.getByTestId('voyage-summary-counts').textContent).toContain('succeeded: 3');
  });

  it('рендерит command-voyage с target.sids', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages/01VCMD0000000000000000002/targets', body: { voyage_id: '01VCMD0000000000000000002', targets: [] } },
      { method: 'GET', url: '/v1/voyages/01VCMD0000000000000000002', body: SAMPLE_VOYAGE_COMMAND },
    ]);
    renderVoyage('01VCMD0000000000000000002');
    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
    });
    expect(screen.getByText('core.cmd.shell')).toBeInTheDocument();
    expect(screen.getByText(/host-a\.example\.com/)).toBeInTheDocument();
    // Нет summary → pending-сообщение.
    expect(screen.getByText(/Summary появится по мере выполнения/)).toBeInTheDocument();
  });

  it('ошибка API → errorBox', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, status: 404, body: { title: 'not found' } },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => {
      expect(screen.getByText(/Ошибка 404/)).toBeInTheDocument();
    });
  });

  it('progress bar рассчитывается корректно', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => {
      expect(screen.getByLabelText('progress')).toBeInTheDocument();
    });
    // 3/3 batches → 100%
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // ФИКС 1: Batch N/M — barrier vs window
  // ──────────────────────────────────────────────

  it('barrier: текущий_батч/тотал рендерится (3/10)', async () => {
    const vid = VOYAGE_BARRIER_PARTIAL.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${vid}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${vid}`, body: VOYAGE_BARRIER_PARTIAL },
    ]);
    renderVoyage(vid);
    await waitFor(() => expect(screen.getByLabelText('progress')).toBeInTheDocument());
    // заголовок прогресса должен показывать «Batch 3 / 10»
    expect(screen.getByText(/Batch 3\s*\/\s*10/)).toBeInTheDocument();
  });

  it('barrier: terminal succeeded → 10/10 в заголовке (не 0/1)', async () => {
    const vid = VOYAGE_BARRIER_TERMINAL.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${vid}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${vid}`, body: VOYAGE_BARRIER_TERMINAL },
    ]);
    renderVoyage(vid);
    await waitFor(() => expect(screen.getByLabelText('progress')).toBeInTheDocument());
    expect(screen.getByText(/Batch 10\s*\/\s*10/)).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('barrier: single batch (1/1)', async () => {
    const voyage = { ...SAMPLE_VOYAGE_SCENARIO, batch_mode: 'barrier', total_batches: 1, current_batch_index: 1, status: 'succeeded' };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${voyage.voyage_id}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${voyage.voyage_id}`, body: voyage },
    ]);
    renderVoyage(voyage.voyage_id);
    await waitFor(() => expect(screen.getByLabelText('progress')).toBeInTheDocument());
    expect(screen.getByText(/Batch 1\s*\/\s*1/)).toBeInTheDocument();
  });

  it('window: НЕ показывает «Batch N/M», а прогресс по targets (done/scope_size)', async () => {
    const vid = VOYAGE_WINDOW.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${vid}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${vid}`, body: VOYAGE_WINDOW },
    ]);
    renderVoyage(vid);
    await waitFor(() => expect(screen.getByLabelText('progress')).toBeInTheDocument());
    // НЕ должно быть «Batch N/M»
    expect(screen.queryByText(/Batch\s+\d+\s*\/\s*\d+/)).toBeNull();
    // Должен быть прогресс по хостам: succeeded+failed+cancelled=5, scope_size=5 → 5/5
    expect(screen.getByText(/5\s*\/\s*5/)).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // ФИКС 2: кликабельный фильтр summary → targets
  // ──────────────────────────────────────────────

  it('клик «succeeded» → видны только succeeded targets', async () => {
    const voyage = { ...SAMPLE_VOYAGE_SCENARIO, summary: { total: 3, succeeded: 2, failed: 1, cancelled: 0 } };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: SUMMARY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: voyage },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-summary-counts')).toBeInTheDocument());

    const user = userEvent.setup();
    const summaryBox = screen.getByTestId('voyage-summary-counts');
    const succeededBadge = summaryBox.querySelector('[data-filter="succeeded"]');
    expect(succeededBadge).not.toBeNull();
    await user.click(succeededBadge!);

    // После фильтра host-a и host-c (succeeded) видны, host-b (failed) — нет
    await waitFor(() => {
      expect(screen.queryByText('host-b')).toBeNull();
    });
    expect(screen.getByText('host-a')).toBeInTheDocument();
  });

  it('клик «failed» → видны только failed targets', async () => {
    const voyage = { ...SAMPLE_VOYAGE_SCENARIO, summary: { total: 3, succeeded: 2, failed: 1, cancelled: 0 } };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: SUMMARY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: voyage },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-summary-counts')).toBeInTheDocument());

    const user = userEvent.setup();
    const summaryBox = screen.getByTestId('voyage-summary-counts');
    const failedBadge = summaryBox.querySelector('[data-filter="failed"]');
    expect(failedBadge).not.toBeNull();
    await user.click(failedBadge!);

    await waitFor(() => {
      expect(screen.queryByText('host-a')).toBeNull();
    });
    expect(screen.getByText('host-b')).toBeInTheDocument();
  });

  it('повторный клик на тот же фильтр → сброс (все targets видны)', async () => {
    const voyage = { ...SAMPLE_VOYAGE_SCENARIO, summary: { total: 3, succeeded: 2, failed: 1, cancelled: 0 } };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: SUMMARY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: voyage },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-summary-counts')).toBeInTheDocument());

    const user = userEvent.setup();
    const summaryBox = screen.getByTestId('voyage-summary-counts');
    const failedBadge = summaryBox.querySelector('[data-filter="failed"]');
    // Клик 1: фильтр
    await user.click(failedBadge!);
    await waitFor(() => expect(screen.queryByText('host-a')).toBeNull());
    // Клик 2: сброс
    await user.click(failedBadge!);
    await waitFor(() => {
      expect(screen.getByText('host-a')).toBeInTheDocument();
      expect(screen.getByText('host-b')).toBeInTheDocument();
    });
  });

  it('активный фильтр-бейдж имеет data-active=true', async () => {
    const voyage = { ...SAMPLE_VOYAGE_SCENARIO, summary: { total: 3, succeeded: 2, failed: 1, cancelled: 0 } };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: SUMMARY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: voyage },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-summary-counts')).toBeInTheDocument());

    const user = userEvent.setup();
    const summaryBox = screen.getByTestId('voyage-summary-counts');
    const succeededBadge = summaryBox.querySelector('[data-filter="succeeded"]');
    await user.click(succeededBadge!);
    await waitFor(() => {
      expect(succeededBadge!.getAttribute('data-active')).toBe('true');
    });
  });

  // ──────────────────────────────────────────────
  // [LINKS] кликабельные ссылки
  // ──────────────────────────────────────────────

  it('[LINKS] started_by_aid рендерится ссылкой на /archons/:aid', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'archon-alice' });
    expect(link).toHaveAttribute('href', '/archons/archon-alice');
  });

  it('[LINKS] target.sids в command-voyage рендерятся ссылками на /souls/:sid', async () => {
    const cmdId = SAMPLE_VOYAGE_COMMAND.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${cmdId}/targets`, body: { voyage_id: cmdId, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${cmdId}`, body: SAMPLE_VOYAGE_COMMAND },
    ]);
    renderVoyage(cmdId);
    await waitFor(() => expect(screen.getByText('running')).toBeInTheDocument());

    const linkA = screen.getByRole('link', { name: 'host-a.example.com' });
    expect(linkA).toHaveAttribute('href', '/souls/host-a.example.com');

    const linkB = screen.getByRole('link', { name: 'host-b.example.com' });
    expect(linkB).toHaveAttribute('href', '/souls/host-b.example.com');
  });

  it('[LINKS] разделитель «, » между SID-ссылками сохранён визуально', async () => {
    const cmdId = SAMPLE_VOYAGE_COMMAND.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${cmdId}/targets`, body: { voyage_id: cmdId, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${cmdId}`, body: SAMPLE_VOYAGE_COMMAND },
    ]);
    renderVoyage(cmdId);
    await waitFor(() => expect(screen.getByText('running')).toBeInTheDocument());

    // Оба SID-элемента присутствуют как ссылки, значит визуальный разделитель отработал.
    expect(screen.getAllByRole('link', { name: /host-[ab]\.example\.com/ })).toHaveLength(2);
    // Текстовое содержимое ячейки содержит запятую-разделитель.
    const sidCell = screen.getByRole('link', { name: 'host-a.example.com' }).closest('span')!.parentElement!;
    expect(sidCell.textContent).toContain(',');
  });

  it('[LINKS] command-voyage без target.sids — секция target.sids не рендерится', async () => {
    const voyage = { ...SAMPLE_VOYAGE_COMMAND, target: {} };
    const cmdId = voyage.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${cmdId}/targets`, body: { voyage_id: cmdId, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${cmdId}`, body: voyage },
      { method: 'GET', url: '/v1/audit', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);
    renderVoyage(cmdId);
    await waitFor(() => expect(screen.getByText('running')).toBeInTheDocument());

    // Нет ссылок на /souls/... и нет текста target.sids.
    expect(screen.queryByRole('link', { name: /host-/ })).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // Секция «Уведомления» прогона
  // ──────────────────────────────────────────────

  it('уведомления пусты → empty-state', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      { method: 'GET', url: '/v1/audit', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-notifications-section')).toBeInTheDocument());
    expect(screen.getByText(/Уведомлений по этому прогону не было/)).toBeInTheDocument();
    expect(screen.queryByTestId('voyage-notifications-table')).not.toBeInTheDocument();
  });

  it('уведомления: delivered показывается с бейджем ok, failed — danger', async () => {
    const deliveredEv = {
      id: 'AUD01DELIVERED00000000001',
      type: 'herald.delivered',
      source: 'keeper_internal',
      correlation_id: VOYAGE_ID,
      created_at: new Date().toISOString(),
      payload: { herald: 'ops-webhook', tiding: 'run-failures', status_code: 200, attempt: 1 },
    };
    const failedEv = {
      id: 'AUD01FAILED0000000000001',
      type: 'herald.failed',
      source: 'keeper_internal',
      correlation_id: VOYAGE_ID,
      created_at: new Date().toISOString(),
      payload: { herald: 'ops-webhook', tiding: 'run-failures', status_code: 503, attempt: 2 },
    };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [deliveredEv, failedEv], offset: 0, limit: 200, total: 2 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-notifications-table')).toBeInTheDocument());

    // Обе строки присутствуют.
    expect(screen.getByTestId(`notif-row-${deliveredEv.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`notif-row-${failedEv.id}`)).toBeInTheDocument();

    // Herald-ссылка.
    const heraldLinks = screen.getAllByRole('link', { name: 'ops-webhook' });
    expect(heraldLinks.length).toBeGreaterThanOrEqual(1);
    expect(heraldLinks[0]).toHaveAttribute('href', '/notifications/heralds/ops-webhook');

    // Статусы: delivered → «доставлено», failed → «ошибка».
    expect(screen.getByText('доставлено')).toBeInTheDocument();
    expect(screen.getByText('ошибка')).toBeInTheDocument();

    // Код ответа.
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('503')).toBeInTheDocument();
  });

  it('audit-запрос уведомлений отправляет correlation_id=voyage_id', async () => {
    const calls: string[] = [];
    const origFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (method === 'GET') calls.push(urlStr);
      if (urlStr.includes('/targets')) return new Response(JSON.stringify(EMPTY_TARGETS), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (urlStr.startsWith(`/v1/voyages/${VOYAGE_ID}`)) return new Response(JSON.stringify(SAMPLE_VOYAGE_SCENARIO), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (urlStr.startsWith('/v1/audit')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 599 });
    });
    vi.stubGlobal('fetch', origFetch);

    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-notifications-section')).toBeInTheDocument());

    const auditCall = calls.find((u) => u.startsWith('/v1/audit'));
    expect(auditCall).toBeDefined();
    expect(auditCall).toContain(`correlation_id=${VOYAGE_ID}`);
    expect(auditCall).toContain('type=herald.delivered');
    expect(auditCall).toContain('type=herald.failed');
  });
});
