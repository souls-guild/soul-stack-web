import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { RunDetail } from '../pages/incarnations/RunDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const APPLY_ID = '01RUN00000000000000000009';
const URL = `/v1/incarnations/redis-prod/runs/${APPLY_ID}`;

function host(sid: string, extra: Record<string, unknown> = {}) {
  return { sid, status: 'success', passage: 0, attempt: 1, cancel_requested: false, ...extra };
}

function runBody(hosts: unknown[]) {
  return {
    apply_id: APPLY_ID,
    scenario: 'create',
    status: 'success',
    started_at: '2026-07-29T10:00:00Z',
    finished_at: '2026-07-29T10:05:00Z',
    started_by_aid: 'archon-alice',
    hosts,
  };
}

function render() {
  renderWithProviders(
    <Routes>
      <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
    </Routes>,
    `/incarnations/redis-prod/runs/${APPLY_ID}`,
  );
}

describe('deprecation notices on the run page', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  // The whole point of the feature: the run SUCCEEDED. A deprecated parameter is
  // honored until the version that drops it, so showing this as a failure would
  // send the operator looking for a breakage that has not happened yet.
  it('shows the notice on a successful run without turning it into a failure', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: URL,
        body: runBody([
          host('web-1.local', {
            notices: [
              {
                code: 'param_deprecated',
                module: 'core.cmd',
                param: 'onlyif',
                message: 'deprecated since 0.4.0, removed in 0.6.0 — use unless',
              },
            ],
          }),
        ]),
      },
    ]);

    render();

    await screen.findByTestId('run-notices-section');
    expect(screen.getByTestId('run-notice-host-web-1.local')).toHaveTextContent(
      'deprecated since 0.4.0, removed in 0.6.0 — use unless',
    );
    expect(
      screen.queryByTestId('run-failed-section'),
      'a deprecation notice must not be rendered through the failure path',
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('run-status')).toHaveTextContent('success');
  });

  // Per host, not folded into one badge for the run: a park mid-upgrade answers
  // differently from host to host, and which hosts still pass the old parameter
  // is the question the operator actually has.
  it('keeps notices per host instead of collapsing them into one', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: URL,
        body: runBody([
          host('old-1.local', {
            notices: [{ code: 'param_deprecated', module: 'core.cmd', param: 'onlyif', message: 'old-1 speaks' }],
          }),
          host('new-1.local'),
        ]),
      },
    ]);

    render();

    await screen.findByTestId('run-notice-host-old-1.local');
    expect(
      screen.queryByTestId('run-notice-host-new-1.local'),
      'a host that reported nothing must not be listed',
    ).not.toBeInTheDocument();
    // The table flags the same host, so the spread is visible without scrolling
    // down to read the messages.
    expect(screen.getByTestId('run-host-row-old-1.local')).toHaveTextContent('deprecated params');
    expect(screen.getByTestId('run-host-row-new-1.local')).not.toHaveTextContent('deprecated params');
  });

  // `notices` is declared `array | null`, so null is a value the server may
  // actually send — reading .length off it would take the page down.
  it('survives notices: null and shows no empty frame when nothing is deprecated', async () => {
    installFetchMock([
      { method: 'GET', url: URL, body: runBody([host('web-1.local', { notices: null }), host('web-2.local')]) },
    ]);

    render();

    await screen.findByTestId('run-hosts-table');
    await waitFor(() =>
      expect(
        screen.queryByTestId('run-notices-section'),
        'with nothing deprecated the page must look exactly as it did before',
      ).not.toBeInTheDocument(),
    );
  });
});
