import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RunTasks } from '../pages/incarnations/RunTasks';
import { hostText } from '../pages/incarnations/runTaskParams';
import type { RunTaskParamCell, RunTaskView } from '../api/keeper';

// "Input by host" (NIM-985): a task whose input differs between hosts shows the
// per-host panel INSTEAD of the params panel; a value chip filters the host table.

const sids = (n: number) => Array.from({ length: n }, (_, i) => `redis-${String(i + 1).padStart(2, '0')}`);

function okHosts(list: string[]) {
  return list.map((sid) => ({ sid, status: 'TASK_STATUS_OK' as const, output: { changed: true } }));
}

const PER_HOST: RunTaskView = {
  plan_index: 0,
  passage: 0,
  id: 'configure node',
  module: 'redis.node.configure',
  params: { config_path: '/etc/redis/redis.conf', maxmemory: '<per-host>', owner: '<per-host>' },
  params_by_host: {
    hosts: 3,
    cells: [
      { path: 'config_path', same: true, values: [{ value: '/etc/redis/redis.conf' }] },
      {
        path: 'maxmemory',
        same: false,
        values: [
          { value: '4gb', sids: ['redis-02', 'redis-03'] },
          { value: '8gb', sids: ['redis-01'] },
        ],
      },
      {
        path: 'owner',
        same: false,
        values: [
          { value: 'redis', sids: ['redis-01', 'redis-02'] },
          { value: 'root', sids: ['redis-03'] },
        ],
      },
      { path: 'requirepass', same: true, values: [{ value: '***MASKED***' }] },
    ],
  },
  hosts: [
    ...okHosts(['redis-01', 'redis-02']),
    {
      sid: 'redis-03',
      status: 'TASK_STATUS_FAILED',
      error: { code: 'E_APPLY', module: 'redis.node.configure', message: 'permission denied' },
    },
  ],
};

describe('RunTasks — input by host (NIM-985)', () => {
  it('replaces the params panel and lists each key with its values and hosts', () => {
    renderWithProviders(<RunTasks tasks={[PER_HOST]} />, '/');

    expect(screen.queryByTestId('run-task-params')).not.toBeInTheDocument();
    const panel = screen.getByTestId('run-task-params-by-host');
    expect(within(panel).getByTestId('run-task-pbh-row-config_path')).toBeInTheDocument();
    expect(within(panel).getByText('/etc/redis/redis.conf')).toBeInTheDocument();
    expect(within(panel).getAllByText('all 3')).toHaveLength(2);
    // The mask arrives from the keeper and is shown as it is.
    expect(within(panel).getByText('***MASKED***')).toBeInTheDocument();
    // Up to three hosts are named in the chip.
    expect(within(panel).getByText('redis-02, redis-03')).toBeInTheDocument();
    expect(within(panel).getByText('root')).toBeInTheDocument();
  });

  it('a value chip filters the host table to the hosts that received it; the filter clears', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RunTasks tasks={[PER_HOST]} />, '/');

    await user.click(screen.getByText('root'));
    expect(screen.getByTestId('run-task-host-filter')).toHaveTextContent('owner = root');
    expect(screen.getByTestId('run-task-host-redis-03')).toBeInTheDocument();
    expect(screen.queryByTestId('run-task-host-redis-01')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('run-task-host-filter'));
    expect(screen.queryByTestId('run-task-host-filter')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-task-host-redis-01')).toBeInTheDocument();
  });

  it('a value of its own on every host shows the first few, a "more" toggle and a search', async () => {
    const user = userEvent.setup();
    const list = sids(30);
    const task: RunTaskView = {
      ...PER_HOST,
      params: { announce_ip: '<per-host>' },
      params_by_host: {
        hosts: 30,
        cells: [
          {
            path: 'announce_ip',
            same: false,
            values: list.map((sid, i) => ({ value: `10.20.0.${i + 1}`, sids: [sid] })),
          },
        ],
      },
      hosts: okHosts(list),
    };
    renderWithProviders(<RunTasks tasks={[task]} />, '/');

    const panel = screen.getByTestId('run-task-params-by-host');
    expect(within(panel).getByText('own on each host:')).toBeInTheDocument();
    expect(within(panel).getAllByTestId('run-task-pbh-value')).toHaveLength(6);

    await user.type(within(panel).getByTestId('run-task-pbh-find'), 'redis-17');
    const found = within(panel).getAllByTestId('run-task-pbh-value');
    expect(found).toHaveLength(1);
    expect(found[0]).toHaveTextContent('10.20.0.17');

    await user.clear(within(panel).getByTestId('run-task-pbh-find'));
    await user.click(within(panel).getByText('24 more'));
    expect(within(panel).getAllByTestId('run-task-pbh-value')).toHaveLength(30);
  });

  it('more than five shared leaves collapse into one line, shown on demand', async () => {
    const user = userEvent.setup();
    const shared = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ path: `net.${k}`, same: true, values: [{ value: k }] }));
    const task: RunTaskView = {
      ...PER_HOST,
      params_by_host: {
        hosts: 2,
        cells: [...shared, { path: 'net.ip', same: false, values: [{ value: '1', sids: ['redis-01'] }, { value: '2', sids: ['redis-02'] }] }],
      },
    };
    renderWithProviders(<RunTasks tasks={[task]} />, '/');

    expect(screen.queryByTestId('run-task-pbh-row-net.a')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-task-pbh-same-toggle')).toHaveTextContent('6 more shared by all hosts — net.a, net.b');
    await user.click(screen.getByText('show'));
    expect(screen.getByTestId('run-task-pbh-row-net.a')).toBeInTheDocument();
  });

  it('a multi-line value lists only its differing lines, and a host text is rebuilt whole', async () => {
    const user = userEvent.setup();
    const task: RunTaskView = {
      ...PER_HOST,
      params: { content: '<per-host>' },
      params_by_host: {
        hosts: 2,
        cells: [
          {
            path: 'content',
            line: 2,
            line_count: 1,
            same: false,
            values: [
              { lines: ['ip 10.0.0.1'], sids: ['redis-01'] },
              { lines: ['ip 10.0.0.2'], sids: ['redis-02'] },
            ],
          },
          {
            path: 'content',
            line: 4,
            line_count: 1,
            same: false,
            values: [
              { lines: ['replicaof 10.0.0.1'], sids: ['redis-02'] },
              { absent: true, sids: ['redis-01'] },
            ],
          },
        ],
        texts: [{ path: 'content', lines: ['port 6379', 'ip 10.0.0.2', '# topology', 'replicaof 10.0.0.1', 'end'] }],
      },
      hosts: okHosts(['redis-01', 'redis-02']),
    };
    renderWithProviders(<RunTasks tasks={[task]} />, '/');

    const panel = screen.getByTestId('run-task-params-by-host');
    expect(within(panel).getByText('text, 5 lines · 3 shared by all')).toBeInTheDocument();
    expect(within(panel).getByText('line 2')).toBeInTheDocument();
    expect(within(panel).getByText('line 4')).toBeInTheDocument();
    expect(within(panel).getByText('no line')).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('run-task-pbh-host-text-content'), 'redis-01');
    expect(screen.getByTestId('run-task-pbh-text-content').textContent).toBe('port 6379\nip 10.0.0.1\n# topology\nend');
  });

  it('an empty line in a hunk is named, not left as a blank chip', () => {
    const task: RunTaskView = {
      ...PER_HOST,
      params: { content: '<per-host>' },
      params_by_host: {
        hosts: 2,
        cells: [
          {
            path: 'content',
            line: 3,
            line_count: 0,
            same: false,
            values: [
              { lines: [''], sids: ['redis-01'] },
              { absent: true, sids: ['redis-02'] },
            ],
          },
        ],
        texts: [{ path: 'content', lines: ['x', 'y'] }],
      },
      hosts: okHosts(['redis-01', 'redis-02']),
    };
    renderWithProviders(<RunTasks tasks={[task]} />, '/');
    const panel = screen.getByTestId('run-task-params-by-host');
    expect(within(panel).getByText('after line 2')).toBeInTheDocument();
    expect(within(panel).getByText('(empty line)')).toBeInTheDocument();
  });

  it('switching tasks drops the host filter of the previous one', async () => {
    const user = userEvent.setup();
    const other: RunTaskView = {
      ...PER_HOST,
      plan_index: 1,
      id: 'restart',
      params: { unit: 'redis' },
      params_by_host: undefined,
      hosts: okHosts(['redis-01', 'redis-02', 'redis-03']),
    };
    renderWithProviders(<RunTasks tasks={[PER_HOST, other]} />, '/');

    await user.click(screen.getByTestId('run-task-item-0'));
    await user.click(screen.getByText('root'));
    expect(screen.queryByTestId('run-task-host-redis-01')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('run-task-item-1'));
    expect(screen.queryByTestId('run-task-host-filter')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-task-host-redis-01')).toBeInTheDocument();
  });

  it('a task without per-host input keeps the params panel', () => {
    const task: RunTaskView = { ...PER_HOST, params: { cmd: 'true' }, params_by_host: undefined };
    renderWithProviders(<RunTasks tasks={[task]} />, '/');
    expect(screen.getByTestId('run-task-params')).toHaveTextContent('cmd');
    expect(screen.queryByTestId('run-task-params-by-host')).not.toBeInTheDocument();
  });
});

describe('hostText', () => {
  it('replaces each hunk range by the host variant, insertions included', () => {
    const hunks: RunTaskParamCell[] = [
      { path: 't', line: 1, line_count: 0, same: false, values: [{ lines: ['head'], sids: ['a'] }, { absent: true, sids: ['b'] }] },
      { path: 't', line: 2, line_count: 2, same: false, values: [{ lines: ['X'], sids: ['a'] }, { lines: ['2', '3'], sids: ['b'] }] },
    ];
    expect(hostText(['1', '2', '3', '4'], hunks, 'a')).toEqual(['head', '1', 'X', '4']);
    expect(hostText(['1', '2', '3', '4'], hunks, 'b')).toEqual(['1', '2', '3', '4']);
  });
});
