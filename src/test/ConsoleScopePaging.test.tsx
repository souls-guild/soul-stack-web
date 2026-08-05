// Guard tests for the console scope against a registry that does not fit in one
// page (NIM-448).
//
// The wall connects to whatever the scope resolves to, and the scope is matched
// client-side against `GET /v1/souls` — an endpoint that serves at most 1000 rows
// per request. A single read therefore made every host past row 1000 unreachable
// from the console with nothing on screen to say so.
//
// The read itself is pinned in soulsListAll.test.ts. What is pinned here is what
// the operator is told when the read could not cover the registry, and when the
// soulprint criterion has more candidates than it will read one at a time — in
// both cases connecting to the subset that happened to be cheap is the failure,
// not the fallback.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { keeperApi } from '../api/keeper';
import { ScopePicker } from '../pages/console/ScopePicker';
import { useHostResolution } from '../pages/console/useHostResolution';
import { EMPTY_HOST_CRITERIA, type HostCriteria } from '../pages/run/hostSelector';

type ListAllReply = Awaited<ReturnType<typeof keeperApi.souls.listAll>>;

function souls(n: number, coven: string): ListAllReply['items'] {
  return Array.from({ length: n }, (_, i) => ({
    sid: `host-${String(i).padStart(5, '0')}`,
    covens: [coven],
    status: 'connected',
    transport: 'agent',
    registered_at: '',
  })) as ListAllReply['items'];
}

// Renders the picker over the REAL resolution hook, so the criteria travel the
// path the page uses rather than being handed to the view as props.
function Harness({ criteria }: { criteria: HostCriteria }) {
  const resolution = useHostResolution(criteria);
  return (
    <ScopePicker
      value={criteria}
      onChange={() => undefined}
      matched={resolution.matched}
      loading={resolution.loading}
      soulsUnavailable={resolution.soulsUnavailable}
      soulsTruncated={resolution.soulsTruncated}
      soulsScanned={resolution.soulsScanned}
      soulsTotal={resolution.soulsTotal}
      soulprintOverload={resolution.soulprintOverload}
      soulprintCandidates={resolution.soulprintCandidates}
      invalidSoulprint={resolution.invalidSoulprint}
      regexError={resolution.regexError}
      hasCriteria={resolution.hasCriteria}
      unresolvedIncarnations={resolution.unresolvedIncarnations}
      onConnect={() => undefined}
      onCancel={null}
      connectedCount={0}
    />
  );
}

function stubListAll(reply: Partial<ListAllReply> & { items: ListAllReply['items'] }) {
  vi.spyOn(keeperApi.souls, 'listAll').mockResolvedValue({
    total: reply.items.length,
    truncated: false,
    ...reply,
  } as ListAllReply);
}

describe('console scope over a paged registry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves hosts past the first page', async () => {
    stubListAll({ items: souls(1500, 'prod') });
    renderWithProviders(<Harness criteria={{ ...EMPTY_HOST_CRITERIA, covens: ['prod'] }} />, '/run/console');

    await waitFor(() => expect(screen.getByText(/1500 VMs match/)).toBeInTheDocument());
    expect(screen.queryByTestId('console-souls-truncated')).not.toBeInTheDocument();
  });

  it('says so when the read stopped short of the registry', async () => {
    stubListAll({ items: souls(20, 'prod'), total: 21000, truncated: true });
    renderWithProviders(<Harness criteria={{ ...EMPTY_HOST_CRITERIA, covens: ['prod'] }} />, '/run/console');

    const banner = await screen.findByTestId('console-souls-truncated');
    expect(banner.textContent).toMatch(/20 of 21000/);
  });

  it('refuses a soulprint criterion with more candidates than it will read, and blocks Connect', async () => {
    stubListAll({ items: souls(1200, 'prod') });
    const perHost = vi.spyOn(keeperApi.souls, 'getSoulprint');
    renderWithProviders(
      <Harness criteria={{ ...EMPTY_HOST_CRITERIA, covens: ['prod'], soulprint: 'os.family=debian' }} />,
      '/run/console',
    );

    const warn = await screen.findByTestId('console-soulprint-overload');
    expect(warn.textContent).toMatch(/1200/);
    expect(warn.textContent).toMatch(/1000/);
    // No count next to it — there is no resolved scope to advertise.
    expect(screen.queryByText(/VMs match/)).not.toBeInTheDocument();
    expect(screen.getByTestId('console-connect')).toBeDisabled();
    // And nothing was read per host. This is the load-bearing half: the refusal
    // exists because 1200 host reads (and 1200 query observers behind them) lock
    // the tab, so "refused" has to mean the fan-out never started.
    expect(perHost).not.toHaveBeenCalled();
  });

  it('runs the soulprint criterion when the other criteria narrow the candidates', async () => {
    // A registry well past the limit, narrowed to three by the SID regex: the
    // limit bounds the fan-out, not the registry it was picked out of.
    stubListAll({ items: souls(1200, 'prod') });
    vi.spyOn(keeperApi.souls, 'getSoulprint').mockResolvedValue({
      sid: 'x',
      typed_facts: { os: { family: 'debian' } },
    } as Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>);
    renderWithProviders(
      <Harness
        criteria={{
          ...EMPTY_HOST_CRITERIA,
          sidRegex: 'host-0000[0-2]',
          soulprint: 'os.family=debian',
        }}
      />,
      '/run/console',
    );

    await waitFor(() => expect(screen.getByText(/3 VMs match/)).toBeInTheDocument());
    expect(screen.queryByTestId('console-soulprint-overload')).not.toBeInTheDocument();
  });
});
