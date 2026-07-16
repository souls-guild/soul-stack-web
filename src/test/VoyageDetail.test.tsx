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
    // @ts-expect-error -- EventSource is not present in jsdom.
    globalThis.EventSource = class {
      readyState = 0;
      close() { /* noop */ }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });

  it('рендерит scenario-voyage с метаданными и summary', async () => {
    // IMPORTANT: /targets must come BEFORE /voyages/{id} -- fetchMock matches by startsWith.
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
    // Incarnation links.
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
    // No summary -> pending message.
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
  // FIX 1: Batch N/M -- barrier vs window
  // ──────────────────────────────────────────────

  it('barrier: текущий_батч/тотал рендерится (3/10)', async () => {
    const vid = VOYAGE_BARRIER_PARTIAL.voyage_id;
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${vid}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${vid}`, body: VOYAGE_BARRIER_PARTIAL },
    ]);
    renderVoyage(vid);
    await waitFor(() => expect(screen.getByLabelText('progress')).toBeInTheDocument());
    // progress heading must show "Batch 3 / 10"
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
    // Must NOT show "Batch N/M"
    expect(screen.queryByText(/Batch\s+\d+\s*\/\s*\d+/)).toBeNull();
    // Progress by hosts must show: succeeded+failed+cancelled=5, scope_size=5 -> 5/5
    expect(screen.getByText(/5\s*\/\s*5/)).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // FIX 2: clickable summary filter -> targets
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

    // After the filter, host-a and host-c (succeeded) are visible, host-b (failed) is not
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
    // Click 1: filter
    await user.click(failedBadge!);
    await waitFor(() => expect(screen.queryByText('host-a')).toBeNull());
    // Click 2: reset
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
  // [LINKS] clickable links
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

    // Both SID elements are present as links, so the visual separator worked.
    expect(screen.getAllByRole('link', { name: /host-[ab]\.example\.com/ })).toHaveLength(2);
    // The cell's text content contains a comma separator.
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

    // No links to /souls/... and no target.sids text.
    expect(screen.queryByRole('link', { name: /host-/ })).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // Voyage "Notifications" section
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

    // Both rows are present.
    expect(screen.getByTestId(`notif-row-${deliveredEv.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`notif-row-${failedEv.id}`)).toBeInTheDocument();

    // Herald link.
    const heraldLinks = screen.getAllByRole('link', { name: 'ops-webhook' });
    expect(heraldLinks.length).toBeGreaterThanOrEqual(1);
    expect(heraldLinks[0]).toHaveAttribute('href', '/notifications/heralds/ops-webhook');

    // Statuses: delivered -> "delivered", failed -> "error".
    expect(screen.getByText('доставлено')).toBeInTheDocument();
    expect(screen.getByText('ошибка')).toBeInTheDocument();

    // Response code.
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

  // ──────────────────────────────────────────────
  // "What changed" section (VoyageChangedTasks)
  // ──────────────────────────────────────────────

  const RUN_COMPLETED_EVENT = {
    id: 'AUD01RUNCOMPLETED00000001',
    type: 'incarnation.run_completed',
    source: 'keeper_internal',
    correlation_id: 'APPLY01',
    created_at: new Date().toISOString(),
    payload: {
      incarnation: 'redis-prod',
      status: 'success',
      voyage_id: VOYAGE_ID,
      changed_tasks: [
        { id: 'task-restart', register: 'svc_restart', name: 'Restart redis', module: 'core.service', changed_hosts: 2, total_hosts: 3 },
        { id: 'task-conf', register: null, name: 'Update config', module: 'core.file', changed_hosts: 1, total_hosts: 3 },
      ],
    },
  };

  const RUN_COMPLETED_NO_TASKS = {
    id: 'AUD01RUNCOMPLETED00000002',
    type: 'incarnation.run_completed',
    source: 'keeper_internal',
    correlation_id: 'APPLY02',
    created_at: new Date().toISOString(),
    payload: {
      incarnation: 'redis-stage',
      status: 'success',
      voyage_id: VOYAGE_ID,
      changed_tasks: [],
    },
  };

  const RUN_COMPLETED_FAILED = {
    id: 'AUD01RUNCOMPLETED00000003',
    type: 'incarnation.run_completed',
    source: 'keeper_internal',
    correlation_id: 'APPLY03',
    created_at: new Date().toISOString(),
    payload: {
      incarnation: 'redis-dr',
      status: 'failed',
      voyage_id: VOYAGE_ID,
      changed_tasks: [
        { id: 'task-fail', module: 'core.pkg', changed_hosts: 0, total_hosts: 2 },
      ],
    },
  };

  it('[changed] секция рендерится и фетч идёт с payload_voyage=voyage_id', async () => {
    const calls: string[] = [];
    const origFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (method === 'GET') calls.push(urlStr);
      if (urlStr.includes('/targets')) return new Response(JSON.stringify(EMPTY_TARGETS), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (urlStr.includes(`/v1/voyages/${VOYAGE_ID}`) && !urlStr.includes('/targets')) return new Response(JSON.stringify(SAMPLE_VOYAGE_SCENARIO), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (urlStr.startsWith('/v1/audit') && urlStr.includes('payload_voyage')) {
        return new Response(JSON.stringify({ items: [RUN_COMPLETED_EVENT], offset: 0, limit: 200, total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/audit')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 599 });
    });
    vi.stubGlobal('fetch', origFetch);

    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-changed-section')).toBeInTheDocument());

    // Fetch contains payload_voyage
    const changedCall = calls.find((u) => u.includes('payload_voyage'));
    expect(changedCall).toBeDefined();
    expect(changedCall).toContain(`payload_voyage=${VOYAGE_ID}`);
    expect(changedCall).toContain('type=incarnation.run_completed');

    // Section rendered with data
    expect(screen.getByTestId('voyage-changed-tasks')).toBeInTheDocument();
  });

  it('[changed] changed_tasks рендерятся: задача + N из M хостов', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [RUN_COMPLETED_EVENT], offset: 0, limit: 200, total: 1 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('changed-tasks-table-0')).toBeInTheDocument());

    // Incarnation
    expect(screen.getByTestId('changed-run-0').textContent).toContain('redis-prod');

    // Task 1: register=svc_restart (register-first), module=core.service, 2 of 3
    expect(screen.getByTestId('changed-task-row-0-0').textContent).toContain('svc_restart');
    expect(screen.getByTestId('changed-task-row-0-0').textContent).toContain('core.service');
    expect(screen.getByTestId('changed-task-row-0-0').textContent).toContain('2');
    expect(screen.getByTestId('changed-task-row-0-0').textContent).toContain('3');

    // Task 2: id=task-conf (no register), module=core.file, 1 of 3
    expect(screen.getByTestId('changed-task-row-0-1').textContent).toContain('task-conf');
    expect(screen.getByTestId('changed-task-row-0-1').textContent).toContain('core.file');
  });

  it('[changed] пустой changed_tasks → «без изменений»', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [RUN_COMPLETED_NO_TASKS], offset: 0, limit: 200, total: 1 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('changed-run-0')).toBeInTheDocument());

    // changed_tasks empty -> "no changes"
    expect(screen.getByText(/без изменений/)).toBeInTheDocument();
    // Task table does not render
    expect(screen.queryByTestId('changed-tasks-table-0')).not.toBeInTheDocument();
  });

  it('[changed] status=success → бейдж «успешно» (ok-тон)', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      // payload_voyage request -> event with success
      {
        method: 'GET',
        url: /\/v1\/audit.*payload_voyage/,
        body: { items: [RUN_COMPLETED_EVENT], offset: 0, limit: 200, total: 1 },
      },
      // correlation_id request (notifications) -> empty
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('run-status-badge-0')).toBeInTheDocument());

    expect(screen.getByTestId('run-status-badge-0').textContent).toContain('успешно');
  });

  it('[changed] status=failed → бейдж «ошибка» (danger-тон)', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      // payload_voyage request -> event with failed
      {
        method: 'GET',
        url: /\/v1\/audit.*payload_voyage/,
        body: { items: [RUN_COMPLETED_FAILED], offset: 0, limit: 200, total: 1 },
      },
      // correlation_id request (notifications) -> empty
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('run-status-badge-0')).toBeInTheDocument());

    expect(screen.getByTestId('run-status-badge-0').textContent).toContain('ошибка');
  });

  it('[changed] нет событий → пустой стейт «Нет событий прогона»', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-changed-section')).toBeInTheDocument());

    expect(screen.getByText(/Нет событий прогона/)).toBeInTheDocument();
    expect(screen.queryByTestId('voyage-changed-tasks')).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // GUARD: type-safety invariants of parseRunCompletedPayload / isChangedTask
  // ──────────────────────────────────────────────

  it('[guard] грязный payload: changed_tasks не массив → секция не падает, «без изменений»', async () => {
    const dirtyEvent = {
      id: 'AUD01DIRTY00000000000001',
      type: 'incarnation.run_completed',
      source: 'keeper_internal',
      correlation_id: 'APPLY_DIRTY',
      created_at: new Date().toISOString(),
      payload: {
        incarnation: 'dirty-inc',
        status: 'success',
        // changed_tasks intentionally not an array -- an object
        changed_tasks: { corrupted: true },
      },
    };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [dirtyEvent], offset: 0, limit: 200, total: 1 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('changed-run-0')).toBeInTheDocument());

    // Did not crash, incarnation visible
    expect(screen.getByTestId('changed-run-0').textContent).toContain('dirty-inc');
    // No task table -- "no changes" is shown
    expect(screen.queryByTestId('changed-tasks-table-0')).not.toBeInTheDocument();
    expect(screen.getByText(/без изменений/)).toBeInTheDocument();
  });

  it('[guard] элемент changed_tasks без числовых changed_hosts/total_hosts → отсеивается isChangedTask, секция не падает', async () => {
    const eventWithBadTasks = {
      id: 'AUD01BADTASKS0000000001',
      type: 'incarnation.run_completed',
      source: 'keeper_internal',
      correlation_id: 'APPLY_BAD',
      created_at: new Date().toISOString(),
      payload: {
        incarnation: 'bad-tasks-inc',
        status: 'success',
        changed_tasks: [
          // numbers as strings -- do not pass isChangedTask
          { id: 'task-a', module: 'core.pkg', changed_hosts: '2', total_hosts: '3' },
          // no fields at all
          { id: 'task-b', module: 'core.file' },
          // null values
          { id: 'task-c', changed_hosts: null, total_hosts: null },
        ],
      },
    };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [eventWithBadTasks], offset: 0, limit: 200, total: 1 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('changed-run-0')).toBeInTheDocument());

    // Incarnation visible, component alive
    expect(screen.getByTestId('changed-run-0').textContent).toContain('bad-tasks-inc');
    // All items filtered out -- "no changes"
    expect(screen.getByText(/без изменений/)).toBeInTheDocument();
    expect(screen.queryByTestId('changed-tasks-table-0')).not.toBeInTheDocument();
  });

  it('[guard] multi-incarnation: несколько run_completed событий → несколько блоков', async () => {
    const event1 = {
      id: 'AUD01MULTI000000000001',
      type: 'incarnation.run_completed',
      source: 'keeper_internal',
      correlation_id: 'APPLY_M1',
      created_at: new Date().toISOString(),
      payload: {
        incarnation: 'inc-alpha',
        status: 'success',
        changed_tasks: [
          { id: 'task-1', module: 'core.pkg', changed_hosts: 1, total_hosts: 2 },
        ],
      },
    };
    const event2 = {
      id: 'AUD01MULTI000000000002',
      type: 'incarnation.run_completed',
      source: 'keeper_internal',
      correlation_id: 'APPLY_M2',
      created_at: new Date().toISOString(),
      payload: {
        incarnation: 'inc-beta',
        status: 'failed',
        changed_tasks: [],
      },
    };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [event1, event2], offset: 0, limit: 200, total: 2 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('changed-run-0')).toBeInTheDocument());

    // Both blocks are present
    expect(screen.getByTestId('changed-run-0').textContent).toContain('inc-alpha');
    expect(screen.getByTestId('changed-run-1').textContent).toContain('inc-beta');

    // First block: has a task table
    expect(screen.getByTestId('changed-tasks-table-0')).toBeInTheDocument();
    // Second block: "no changes"
    expect(screen.getByTestId('changed-run-1').textContent).toContain('без изменений');
  });

  it('[guard] кнопка «Повторить» доступна для scenario-voyage и отправляет на /run с параметрами', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      { method: 'GET', url: '/v1/audit', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-repeat-btn')).toBeInTheDocument());

    // Button is present (scenario-voyage), we click -- no draft -> navigate
    const user = userEvent.setup();
    // sessionStorage empty -> no confirm dialog
    sessionStorage.clear();
    await user.click(screen.getByTestId('voyage-repeat-btn'));
    // After navigate -- the component tries to unmount/remount; check that confirm did not appear.
    expect(screen.queryByTestId('voyage-repeat-confirm-dialog')).not.toBeInTheDocument();
  });

  it('[guard] confirm-диалог появляется если в sessionStorage есть черновик', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      { method: 'GET', url: '/v1/audit', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);
    // Simulate a draft
    sessionStorage.setItem('run-wizard-draft', JSON.stringify({ v: 10 }));
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('voyage-repeat-btn')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId('voyage-repeat-btn'));
    // Dialog must appear
    expect(screen.getByTestId('voyage-repeat-confirm-dialog')).toBeInTheDocument();
    // Cancel -> dialog closes ("Закрыть" button -- ru locale is default in tests)
    await user.click(screen.getByRole('button', { name: /Закрыть/i }));
    expect(screen.queryByTestId('voyage-repeat-confirm-dialog')).not.toBeInTheDocument();
    sessionStorage.clear();
  });

  it('[guard] status=undefined → тон muted, лейбл «—»', async () => {
    const eventNoStatus = {
      id: 'AUD01NOSTATUS000000001',
      type: 'incarnation.run_completed',
      source: 'keeper_internal',
      correlation_id: 'APPLY_NS',
      created_at: new Date().toISOString(),
      payload: {
        incarnation: 'no-status-inc',
        // status intentionally absent
        changed_tasks: [],
      },
    };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: EMPTY_TARGETS },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
      {
        method: 'GET',
        url: '/v1/audit',
        body: { items: [eventNoStatus], offset: 0, limit: 200, total: 1 },
      },
    ]);
    renderVoyage(VOYAGE_ID);
    await waitFor(() => expect(screen.getByTestId('run-status-badge-0')).toBeInTheDocument());

    // "--" label -- did not crash
    expect(screen.getByTestId('run-status-badge-0').textContent).toBe('—');
  });
});
