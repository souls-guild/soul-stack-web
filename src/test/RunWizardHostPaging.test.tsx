// Guard tests for the Command workload's host resolution against a registry that
// does not fit in one page (NIM-448).
//
// The wizard matches the criteria client-side against `GET /v1/souls` and ships
// the survivors as an explicit `target.sids`. That endpoint serves at most 1000
// rows per request, so a single read makes host #1001 invisible — and the only
// signal was a counter the operator had to compare, by eye, against the table
// they arrived from. After NIM-443 that table's button says "Run command on these
// hosts", which makes the quiet shortfall a lie rather than a subtlety.
//
// What these pin:
//
//  1. THE RESOLUTION SPANS THE WHOLE REGISTRY, not its first page — the count,
//     the shipped SID list, and the hosts past row 1000 in both.
//  2. A REQUESTED SID THAT DOES NOT RESOLVE IS NAMED. `?target_sids=` promises
//     those hosts by name; one the registry does not carry (out of the operator's
//     `soul.list` scope, or a members row that only ever came from telemetry)
//     matched nothing and left without a word.
//  3. THE NOTICE IS ABOUT THE LINK, NOT ABOUT FILTERING. Once the operator edits
//     the criteria, hosts dropping out is the edit doing its job.
//  4. A REGISTRY PAST THE READ CAP SAYS SO. The read is bounded; pretending it
//     was complete is what this ticket is about.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, render, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { keeperApi } from '../api/keeper';
import { tokenStore } from '../api/tokenStore';

const PAGE = 1000;

function renderWizard(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/run" element={<RunWizard />} />
      <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Registry {
  sids: string[];
  coven: string;
  /** Registered hosts NOT carrying `coven` — they must never reach the target. */
  decoys?: string[];
}

const CMD_MODULE = {
  name: 'core.cmd',
  kind: 'core',
  description: 'shell command',
  states: ['shell'],
  errand_safe: true,
  params: [{ name: 'cmd', type: 'string', required: true, multiline: true, example: 'uptime' }],
};

// Serves the souls registry the way the backend does: offset/limit honoured, a
// page capped at 1000 rows (a bigger `limit` is a 400 there, so it is one here
// too), exact total. `decoys` are registered hosts that do NOT carry the coven —
// without them "the matched set" and "the whole registry" are the same number and
// nothing distinguishes shipping one from shipping the other. Records the POST
// body so the submitted target can be inspected.
function stubFetch(registry: Registry) {
  const posted: { body: Record<string, unknown> | null } = { body: null };
  const rows = [
    ...registry.sids.map((sid) => ({ sid, covens: [registry.coven] })),
    ...(registry.decoys ?? []).map((sid) => ({ sid, covens: ['somewhere-else'] })),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        if (url.includes('/v1/voyages/preview')) {
          return json({ kind: 'command', scope_size: 1, total_batches: 1, batch_mode: 'barrier' });
        }
        posted.body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
        return json({ voyage_id: 'vy-01HZ00000000' }, 202);
      }
      if (url.match(/\/v1\/modules\/[^/?]+/)) {
        return json(CMD_MODULE);
      }
      if (url.includes('/v1/modules')) {
        return json({ items: [CMD_MODULE] });
      }
      // BEFORE the list branch: `/v1/souls/<sid>/soulprint` starts with `/v1/souls`
      // too, and letting the list answer it makes every soulprint criterion match
      // nothing — a test asserting "some hosts match" then passes on zero.
      const soulprint = url.match(/\/v1\/souls\/([^/?]+)\/soulprint/);
      if (soulprint) {
        return json({
          sid: decodeURIComponent(soulprint[1]),
          typed_facts: { os: { family: 'debian' } },
        });
      }
      if (url.includes('/v1/souls')) {
        const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
        const offset = Number(params.get('offset') ?? 0);
        const limit = Number(params.get('limit') ?? 50);
        if (limit > PAGE) return json({ detail: `invalid limit ${limit}: must be <= ${PAGE}` }, 400);
        const window = rows.slice(offset, offset + limit);
        return json({
          items: window.map((r) => ({
            sid: r.sid,
            transport: 'agent',
            status: 'connected',
            covens: r.covens,
            registered_at: '',
          })),
          offset,
          limit,
          total: rows.length,
        });
      }
      return json({}, 404);
    }) as typeof fetch,
  );
  return posted;
}

function fleet(size: number, prefix = 'host'): string[] {
  return Array.from({ length: size }, (_, i) => `${prefix}-${String(i).padStart(4, '0')}.example.com`);
}

describe('RunWizard host resolution across pages', () => {
  beforeEach(() => {
    tokenStore.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('a coven criterion resolves the whole registry, not its first page', async () => {
    // 1500 members + 300 decoys: the count can only be right if the read spans
    // every page AND the criterion still narrows.
    stubFetch({ sids: fleet(1500), coven: 'prod', decoys: fleet(300, 'other') });
    renderWizard('/run?workload=command&target_coven=prod');
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(
      () => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1500 hosts match/),
      { timeout: 4000 },
    );
    // 1800 rows read out of a 20-page budget — nothing to warn about.
    expect(screen.queryByTestId('souls-truncated-warn')).not.toBeInTheDocument();
  });

  it('ships the hosts past the first page in target.sids', async () => {
    const posted = stubFetch({ sids: fleet(1200), coven: 'prod', decoys: fleet(50, 'other') });
    renderWizard('/run?workload=command&target_coven=prod');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(
      () => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1200 hosts match/),
      { timeout: 4000 },
    );
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run|Launch|Submit/ }));

    await waitFor(() => expect(posted.body).not.toBeNull());
    const target = posted.body?.target as { sids?: string[] } | undefined;
    expect(target?.sids).toHaveLength(1200);
    // The tail of the registry is in the target...
    expect(target?.sids).toContain('host-1199.example.com');
    // ...and the hosts that merely exist are not.
    expect(target?.sids).not.toContain('other-0000.example.com');
  });

  it('names a requested SID the registry does not carry', async () => {
    stubFetch({ sids: ['host-a.example.com', 'host-b.example.com'], coven: 'dev' });
    // host-a repeated: a link naming one host twice asks for one host, so the
    // denominator must be 3, not 4.
    renderWizard(
      '/run?workload=command&target_sids=host-a.example.com%2Cghost.example.com%2Chost-b.example.com%2Chost-a.example.com',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));

    const warn = await screen.findByTestId('targets-unresolved-warn');
    expect(warn.textContent).toContain('ghost.example.com');
    expect(warn.textContent).toMatch(/1 of 3/);
    // And it is not crying wolf over the two that did resolve.
    expect(warn.textContent).not.toContain('host-a.example.com');
  });

  // The suppression rules must not swallow the case they most need to report: a
  // link whose hosts are ALL out of reach. "Nothing resolved" is a legitimate
  // answer to warn about, not a reason to stay quiet.
  it('names every requested SID when none of them resolve', async () => {
    stubFetch({ sids: ['host-a.example.com'], coven: 'dev' });
    renderWizard('/run?workload=command&target_sids=ghost-1.example.com%2Cghost-2.example.com');
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));

    const warn = await screen.findByTestId('targets-unresolved-warn');
    expect(warn.textContent).toMatch(/2 of 2/);
    expect(warn.textContent).toContain('ghost-1.example.com');
    expect(warn.textContent).toContain('ghost-2.example.com');
  });

  // A Cadence with a coven hands the Keeper the label and lets it resolve the hosts
  // every tick, so the client's SID list is not the target and a SID missing from
  // the client's read says nothing about what will run.
  it('says nothing about unresolved SIDs when the run ships a coven, not the SIDs', async () => {
    stubFetch({ sids: ['host-a.example.com'], coven: 'dev' });
    renderWizard(
      '/run?workload=command&target_coven=dev&target_sids=host-a.example.com%2Cghost.example.com',
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Recurring'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/hosts match/));

    expect(screen.queryByTestId('targets-unresolved-warn')).not.toBeInTheDocument();
  });

  // The exemption above is about the coven, not about Recurring: a Cadence with no
  // coven falls back to shipping the snapshot SIDs, so the notice belongs there.
  it('still names unresolved SIDs for a Cadence with no coven to late-bind', async () => {
    stubFetch({ sids: ['host-a.example.com'], coven: 'dev' });
    renderWizard('/run?workload=command&target_sids=host-a.example.com%2Cghost.example.com');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Recurring'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const warn = await screen.findByTestId('targets-unresolved-warn');
    expect(warn.textContent).toContain('ghost.example.com');
  });

  it('says nothing when the registry could not be read at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/v1/souls')) return json({ detail: 'boom' }, 500);
        return json({}, 404);
      }) as typeof fetch,
    );
    renderWizard('/run?workload=command&target_sids=host-a.example.com%2Chost-b.example.com');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByLabelText('Host preview');

    // Zero hosts resolved because the request failed — naming the SIDs would
    // point the operator at the wrong problem.
    await waitFor(() =>
      expect(screen.queryByTestId('targets-unresolved-warn')).not.toBeInTheDocument(),
    );
  });

  it('says nothing when every requested SID resolves', async () => {
    stubFetch({ sids: ['host-a.example.com', 'host-b.example.com'], coven: 'dev' });
    renderWizard('/run?workload=command&target_sids=host-a.example.com%2Chost-b.example.com');
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    expect(screen.queryByTestId('targets-unresolved-warn')).not.toBeInTheDocument();
  });

  it('drops the notice once the operator narrows the criteria themselves', async () => {
    stubFetch({ sids: ['host-a.example.com', 'host-b.example.com'], coven: 'dev' });
    renderWizard(
      '/run?workload=command&target_sids=host-a.example.com%2Cghost.example.com%2Chost-b.example.com',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByTestId('targets-unresolved-warn');

    // An added coven criterion is the operator deciding what leaves the target.
    const covenChip = screen.getByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'dev ');

    await waitFor(() =>
      expect(screen.queryByTestId('targets-unresolved-warn')).not.toBeInTheDocument(),
    );
  });

  // Lifting the 1000-row ceiling lifted it for the soulprint stage too, and that
  // stage reads one host at a time. Over tens of thousands of candidates it locks
  // the tab, so past the limit it does not run — and the criteria resolve to
  // NOTHING rather than to whichever slice was cheap enough to check.
  it('refuses a soulprint filter with more candidates than it will read', async () => {
    stubFetch({ sids: fleet(1200), coven: 'prod' });
    const perHost = vi.spyOn(keeperApi.souls, 'getSoulprint');
    renderWizard('/run?workload=command&target_coven=prod');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(
      () => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1200 hosts match/),
      { timeout: 4000 },
    );
    fireEvent.change(screen.getByLabelText('Soulprint filter'), {
      target: { value: 'os.family=debian' },
    });

    const warn = await screen.findByTestId('soulprint-overload-warn', undefined, { timeout: 4000 });
    expect(warn.textContent).toMatch(/1200/);
    expect(warn.textContent).toMatch(/1000/);
    // No count beside it: there is no resolved set to advertise, and Next stays shut.
    expect(screen.getByLabelText('Host preview').textContent).not.toMatch(/hosts match/);
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    // And nothing was read per host. This is the load-bearing half: the refusal
    // exists because 1200 host reads (and 1200 query observers behind them) lock
    // the tab, so "refused" has to mean the fan-out never started.
    expect(perHost).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // The limit bounds the FAN-OUT, so it counts candidates — not the registry the
  // candidates were picked out of. A big fleet plus a criterion that narrows to a
  // handful is an ordinary soulprint query, and refusing it would break a flow
  // that has always worked.
  it('runs the soulprint filter on a big registry when the criteria narrow it', async () => {
    stubFetch({ sids: fleet(1200), coven: 'prod' });
    renderWizard('/run?workload=command&target_regex=%5Ehost-000%5B0-2%5D%5C.example%5C.com%24');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(
      () => expect(screen.getByLabelText('Host preview').textContent).toMatch(/3 hosts match/),
      { timeout: 4000 },
    );
    fireEvent.change(screen.getByLabelText('Soulprint filter'), {
      target: { value: 'os.family=debian' },
    });

    await waitFor(() =>
      expect(screen.queryByTestId('soulprint-overload-warn')).not.toBeInTheDocument(),
    );
    // The three survive the filter — the stub serves matching facts, so a count of
    // zero here would mean the soulprint stage never got an answer, not that it ran.
    await waitFor(() =>
      expect(screen.getByLabelText('Host preview').textContent).toMatch(/3 hosts match/),
    );
  });

  // The boundary IS the promise: the refusal is justified by "nothing that worked
  // before this change reaches it", and what worked before was one 1000-row page.
  // At exactly 1000 candidates the filter must still run.
  it('runs the soulprint filter at exactly the limit', async () => {
    stubFetch({ sids: fleet(1000), coven: 'prod', decoys: fleet(200, 'other') });
    renderWizard('/run?workload=command&target_coven=prod');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(
      () => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1000 hosts match/),
      { timeout: 4000 },
    );
    fireEvent.change(screen.getByLabelText('Soulprint filter'), {
      target: { value: 'os.family=debian' },
    });

    await waitFor(
      () => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1000 hosts match/),
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('soulprint-overload-warn')).not.toBeInTheDocument();
  }, 15000);

  // The loop's own cap behaviour is pinned in soulsListAll.test.ts; what is pinned
  // here is that the wizard says it out loud instead of rendering the prefix as
  // though it were the registry. Driven through the client rather than through
  // 21 stubbed pages — the numbers on screen are the point, not the round-trips.
  it('a registry past the read cap is called out instead of passed off as complete', async () => {
    stubFetch({ sids: fleet(3), coven: 'prod' });
    vi.spyOn(keeperApi.souls, 'listAll').mockResolvedValue({
      items: fleet(3).map((sid) => ({
        sid,
        transport: 'agent',
        status: 'connected',
        covens: ['prod'],
        registered_at: '',
      })) as Awaited<ReturnType<typeof keeperApi.souls.listAll>>['items'],
      total: 21000,
      truncated: true,
    });
    renderWizard('/run?workload=command&target_coven=prod');
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));

    const warn = await screen.findByTestId('souls-truncated-warn');
    expect(warn.textContent).toMatch(/3 of 21000/);
    vi.restoreAllMocks();
  });
});
