/**
 * NIM-146: the multi-console page, driven through the real WS code path with a
 * fake socket. xterm cannot measure glyphs in jsdom, so TerminalView is stubbed
 * — everything above it (scope step, connect, tabs, per-tab input, search, the
 * disconnect surface) is exercised for real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { keeperApi } from '../api/keeper';
import { bytesToBase64, type ConsoleClientMessage } from '../api/consoleProtocol';
import type { ConsoleTransportHooks } from '../api/consoleSocket';
import styles from '../pages/console/MultiConsole.module.css';

const sent: ConsoleClientMessage[] = [];
let hooks: ConsoleTransportHooks | null = null;
let socketClosed = false;

vi.mock('../pages/console/TerminalView', () => ({
  TerminalView: ({ label }: { label: string }) => <div data-testid={`term-${label}`} />,
}));

vi.mock('../api/consoleSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/consoleSocket')>();
  return {
    ...actual,
    createWebSocketTransport: (h: ConsoleTransportHooks) => {
      hooks = h;
      return {
        send: (msg: ConsoleClientMessage) => sent.push(msg),
        close: () => {
          socketClosed = true;
        },
      };
    },
  };
});

const { MultiConsolePage } = await import('../pages/console/MultiConsolePage');

const SOULS = [
  { sid: 'mongo-ctl-01', covens: ['mongoshard'], status: 'connected', transport: 'agent', traits: { role: 'control' } },
  { sid: 'mongo-sh-01', covens: ['mongoshard'], status: 'connected', transport: 'agent', traits: { role: 'data' } },
  { sid: 'mongo-sh-02', covens: ['mongoshard'], status: 'connected', transport: 'agent', traits: { role: 'data' } },
  // In the incarnation but in no Choir and with no role trait — the ungrouped bucket.
  { sid: 'mongo-arb-01', covens: ['mongoshard'], status: 'connected', transport: 'agent', traits: {} },
  { sid: 'web-01', covens: ['web'], status: 'connected', transport: 'agent', traits: {} },
];

const CHOIRS = [
  { choir_name: 'control', incarnation_name: 'mongoshard', description: null, min_size: null, max_size: null, created_at: '2026-01-01T00:00:00Z', created_by_aid: null },
  { choir_name: 'data', incarnation_name: 'mongoshard', description: null, min_size: null, max_size: null, created_at: '2026-01-01T00:00:00Z', created_by_aid: null },
];
const VOICES: Record<string, string[]> = { control: ['mongo-ctl-01'], data: ['mongo-sh-01', 'mongo-sh-02'] };

function sessionIdOf(sid: string): string {
  const frame = sent.find((m) => m.type === 'open' && m.sid === sid);
  if (!frame || frame.type !== 'open') throw new Error(`no open frame for ${sid}`);
  return frame.session_id;
}

function serverOpens(sid: string) {
  act(() => hooks!.onMessage({ type: 'opened', session_id: sessionIdOf(sid), sid }));
}

function serverChunk(sid: string, text: string) {
  act(() =>
    hooks!.onMessage({
      type: 'chunk',
      session_id: sessionIdOf(sid),
      stream: 'stdout',
      data: bytesToBase64(new TextEncoder().encode(text)),
    }),
  );
}

function stdinTargets(): string[] {
  return sent
    .filter((m) => m.type === 'stdin')
    .map((m) => {
      const open = sent.find((o) => o.type === 'open' && o.session_id === m.session_id);
      return open && open.type === 'open' ? open.sid : '?';
    });
}

async function renderPage(path = '/run/console') {
  const view = renderWithProviders(<MultiConsolePage />, path);
  await waitFor(() => expect(hooks).not.toBeNull());
  act(() => hooks!.onOpen());
  return view;
}

// Scope -> Connect -> N consoles, with every session answered.
async function connectScope(path = '/run/console?incarnation=mongoshard') {
  const user = userEvent.setup();
  await renderPage(path);
  await waitFor(() => expect(screen.getByTestId('console-connect')).toBeEnabled());
  await user.click(screen.getByTestId('console-connect'));
  await waitFor(() => expect(screen.getByTestId('console-wall')).toBeInTheDocument());
  for (const sid of ['mongo-ctl-01', 'mongo-sh-01', 'mongo-sh-02', 'mongo-arb-01']) serverOpens(sid);
  return user;
}

beforeEach(() => {
  // Prefs and groups persist across visits by design — clear so tests do not
  // inherit each other's stored state.
  localStorage.clear();
  sent.length = 0;
  hooks = null;
  socketClosed = false;
  vi.spyOn(keeperApi.souls, 'list').mockResolvedValue({
    items: SOULS,
    total: SOULS.length,
    offset: 0,
    limit: 1000,
  } as Awaited<ReturnType<typeof keeperApi.souls.list>>);
  vi.spyOn(keeperApi.choirs, 'list').mockResolvedValue({ items: CHOIRS } as Awaited<
    ReturnType<typeof keeperApi.choirs.list>
  >);
  vi.spyOn(keeperApi.choirs, 'listVoices').mockImplementation(async (_inc: string, choir: string) => ({
    items: (VOICES[choir] ?? []).map((sid) => ({
      sid,
      choir_name: choir,
      incarnation_name: 'mongoshard',
      role: null,
      position: null,
      added_at: '2026-01-01T00:00:00Z',
      added_by_aid: null,
    })),
  }) as Awaited<ReturnType<typeof keeperApi.choirs.listVoices>>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MultiConsolePage — scope step', () => {
  it('[INVARIANT] a link pre-fills the scope but never connects on its own', async () => {
    await renderPage('/run/console?incarnation=mongoshard');
    await waitFor(() => expect(screen.getByTestId('console-scope')).toBeInTheDocument());

    // Opening root shells is an explicit act; the link only fills the form.
    expect(sent.filter((m) => m.type === 'open')).toHaveLength(0);
    expect(screen.queryByTestId('console-wall')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('console-scope-preview')).toHaveTextContent('4'));
  });

  it('cannot connect until the scope matches something', async () => {
    await renderPage();
    expect(screen.getByTestId('console-connect')).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByTestId('console-scope-regex'), 'nothing-matches-this');
    await waitFor(() => expect(screen.getByTestId('console-scope-preview')).toHaveTextContent(/0/));
    expect(screen.getByTestId('console-connect')).toBeDisabled();
  });

  it('[INVARIANT] a pane cannot be dropped on its own — scope owns membership', async () => {
    await connectScope();
    // A per-pane close would be a second source of truth for "which VMs am I
    // working with", silently contradicting the scope bar above. Excluding a
    // host from commands is the checkbox; removing it is Change selection.
    expect(screen.queryByTestId('pane-detach-mongo-ctl-01')).not.toBeInTheDocument();
    expect(screen.getByTestId('pane-select-mongo-ctl-01')).toBeInTheDocument();
  });

  it('connect opens one console per matched VM', async () => {
    await connectScope();
    const opened = sent.filter((m) => m.type === 'open').map((m) => (m.type === 'open' ? m.sid : ''));
    expect(opened).toEqual(['mongo-ctl-01', 'mongo-sh-01', 'mongo-sh-02', 'mongo-arb-01']);
    expect(screen.getByTestId('pane-mongo-ctl-01')).toBeInTheDocument();
    expect(screen.queryByTestId('pane-web-01')).not.toBeInTheDocument();
  });

  it('narrows the scope by VM name', async () => {
    const user = userEvent.setup();
    await renderPage('/run/console?incarnation=mongoshard');
    await user.type(screen.getByTestId('console-scope-regex'), 'mongo-sh-.*');
    await waitFor(() => expect(screen.getByTestId('console-connect')).toBeEnabled());
    await user.click(screen.getByTestId('console-connect'));

    const opened = sent.filter((m) => m.type === 'open').map((m) => (m.type === 'open' ? m.sid : ''));
    expect(opened).toEqual(['mongo-sh-01', 'mongo-sh-02']);
  });

  it('re-opening the scope and connecting reconciles instead of rebuilding', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-change-scope'));
    await user.type(screen.getByTestId('console-scope-regex'), 'mongo-sh-.*');
    await waitFor(() => expect(screen.getByTestId('console-connect')).toBeEnabled());
    await user.click(screen.getByTestId('console-connect'));

    // The control VM leaves, the two shards stay attached — no reopen for them.
    expect(sent).toContainEqual({ type: 'close', session_id: sessionIdOf('mongo-ctl-01') });
    expect(sent.filter((m) => m.type === 'open' && m.sid === 'mongo-sh-01')).toHaveLength(1);
    expect(screen.queryByTestId('pane-mongo-ctl-01')).not.toBeInTheDocument();
  });
});

describe('MultiConsolePage — operator-defined groups', () => {
  it('starts with no groups — only the All tab', async () => {
    await connectScope();
    expect(screen.getByTestId('console-tab-all')).toHaveTextContent('4');
    expect(screen.getByTestId('console-edit-groups')).toHaveTextContent('Create groups');
  });

  it('auto-split seeds one editable group per value', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));

    // Seeded groups are ordinary groups: named, queried, countable.
    const rows = screen.getAllByTestId(/^console-group-row-/);
    expect(rows).toHaveLength(2);
    expect(screen.getByDisplayValue('trait.role = control')).toBeInTheDocument();
    expect(screen.getByDisplayValue('trait.role = data')).toBeInTheDocument();
  });

  it('a hand-written query defines a group', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-group-add'));

    const queryInput = screen.getByTestId(/^console-group-query-/);
    await user.type(queryInput, 'sid ~ mongo-sh-.*');
    await waitFor(() =>
      expect(screen.getByTestId(/^console-group-count-/)).toHaveTextContent('2'),
    );
  });

  it('[INVARIANT] a broken query matches nothing and says why', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-group-add'));
    await user.type(screen.getByTestId(/^console-group-query-/), 'bogus = 1');

    await waitFor(() => expect(screen.getByTestId(/^console-group-error-/)).toHaveTextContent(/unknown field/i));
    expect(screen.getByTestId(/^console-group-count-/)).toHaveTextContent('0');
  });

  it('the builder reflects a typed query and edits the same string', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-group-add'));
    await user.type(screen.getByTestId(/^console-group-query-/), 'trait.role = data');

    // Typed text shows up as builder rows...
    const valueInput = await screen.findByTestId(/^console-group-value-.*-0$/);
    expect(valueInput).toHaveValue('data');

    // ...and editing a row rewrites the canonical text.
    await user.clear(valueInput);
    await user.type(valueInput, 'control');
    await waitFor(() =>
      expect(screen.getByTestId(/^console-group-query-/)).toHaveValue('trait.role = control'),
    );
  });

  it('groups become tabs, and a tab shows only its own consoles', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));

    const dataTab = screen.getByRole('tab', { name: /^data/ });
    await user.click(dataTab);

    // Hidden, not unmounted — unmounting would dispose the terminal and lose
    // the session's scrollback.
    expect(screen.getByTestId('pane-mongo-ctl-01').className).toContain(styles.paneHidden);
    expect(screen.getByTestId('pane-mongo-sh-01').className).not.toContain(styles.paneHidden);
    expect(screen.getByTestId('term-mongo-ctl-01')).toBeInTheDocument();
  });

  it('reports consoles that no group claimed', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    // mongo-arb-01 has no role trait.
    expect(screen.getByTestId('console-groups-unmatched')).toHaveTextContent('1');
  });

  it('[INVARIANT] leftovers get a working tab, and it reaches only them', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));

    const tab = screen.getByRole('tab', { name: /^no group/ });
    await user.click(tab);
    expect(screen.getByTestId('console-broadcast-send')).toHaveTextContent('no group (1)');

    // The point of a tab over a counter: you can actually work in it.
    await user.type(screen.getByTestId('console-broadcast-input'), 'uptime');
    await user.click(screen.getByTestId('console-broadcast-send'));
    expect(stdinTargets()).toEqual(['mongo-arb-01']);
  });

  it('the leftovers tab disappears once a group claims the last one', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-group-add'));

    const queries = screen.getAllByTestId(/^console-group-query-/);
    await user.type(queries[queries.length - 1], 'sid ~ mongo-arb-.*');

    await waitFor(() => expect(screen.queryByRole('tab', { name: /^no group/ })).not.toBeInTheDocument());
  });

  it('deleting the active group falls back to All', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));
    await user.click(screen.getByRole('tab', { name: /^data/ }));

    await user.click(screen.getByTestId('console-edit-groups'));
    const removes = screen.getAllByTestId(/^console-group-remove-/);
    await user.click(removes[1]);

    await waitFor(() => expect(screen.getByTestId('console-tab-all')).toHaveAttribute('aria-selected', 'true'));
  });
});

describe('MultiConsolePage — per-tab input', () => {
  async function withRoleGroups() {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));
    return user;
  }

  it('[INVARIANT] a command sent from a tab reaches that tab ONLY', async () => {
    const user = await withRoleGroups();
    await user.click(screen.getByRole('tab', { name: /^data/ }));

    await user.type(screen.getByTestId('console-broadcast-input'), 'systemctl restart mongod');
    await user.click(screen.getByTestId('console-broadcast-send'));

    // The control VM must be untouched — that is the whole point of groups.
    expect(stdinTargets()).toEqual(['mongo-sh-01', 'mongo-sh-02']);
    expect(screen.getByTestId('console-broadcast-status')).toHaveTextContent('2');
  });

  it('the All tab reaches every attached console', async () => {
    const user = await connectScope();
    await user.type(screen.getByTestId('console-broadcast-input'), 'uptime');
    await user.click(screen.getByTestId('console-broadcast-send'));
    expect(stdinTargets()).toEqual(['mongo-ctl-01', 'mongo-sh-01', 'mongo-sh-02', 'mongo-arb-01']);
  });

  it('[INVARIANT] each tab keeps its own draft, so a line cannot follow you across', async () => {
    const user = await withRoleGroups();

    await user.click(screen.getByRole('tab', { name: /^data/ }));
    await user.type(screen.getByTestId('console-broadcast-input'), 'drop-the-shard-data');

    await user.click(screen.getByRole('tab', { name: /^control/ }));
    // A command typed for the shards must not be sitting in the control tab.
    expect(screen.getByTestId('console-broadcast-input')).toHaveValue('');

    await user.click(screen.getByRole('tab', { name: /^data/ }));
    expect(screen.getByTestId('console-broadcast-input')).toHaveValue('drop-the-shard-data');
  });

  it('names the active tab on the send button', async () => {
    const user = await withRoleGroups();
    expect(screen.getByTestId('console-broadcast-send')).toHaveTextContent('All (4)');

    await user.click(screen.getByRole('tab', { name: /^control/ }));
    expect(screen.getByTestId('console-broadcast-send')).toHaveTextContent('control (1)');
  });

  it('renaming a group keeps you on the same tab and its draft', async () => {
    const user = await withRoleGroups();
    await user.click(screen.getByRole('tab', { name: /^data/ }));
    await user.type(screen.getByTestId('console-broadcast-input'), 'keep-me');

    await user.click(screen.getByTestId('console-edit-groups'));
    const names = screen.getAllByTestId(/^console-group-name-/);
    await user.clear(names[1]);
    await user.type(names[1], 'shards');
    await user.click(screen.getByTestId('console-groups-done'));

    // Tabs are keyed by id, not name — the draft survives the rename.
    expect(screen.getByRole('tab', { name: /^shards/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('console-broadcast-input')).toHaveValue('keep-me');
  });
});

describe('MultiConsolePage — per-VM arming', () => {
  it('every console is armed by default', async () => {
    await connectScope();
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('4 of 4');
    expect(screen.getByTestId('pane-select-mongo-ctl-01')).toBeChecked();
  });

  it('[INVARIANT] un-checking a VM keeps it out of the send', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('pane-select-mongo-sh-01'));
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('3 of 4');

    await user.type(screen.getByTestId('console-broadcast-input'), 'uptime');
    await user.click(screen.getByTestId('console-broadcast-send'));

    expect(stdinTargets()).toEqual(['mongo-ctl-01', 'mongo-sh-02', 'mongo-arb-01']);
    expect(stdinTargets()).not.toContain('mongo-sh-01');
  });

  it('an un-armed pane is visibly stood down', async () => {
    const user = await connectScope();
    expect(screen.getByTestId('pane-mongo-sh-01').className).toContain(styles.paneArmed);

    await user.click(screen.getByTestId('pane-select-mongo-sh-01'));
    expect(screen.getByTestId('pane-mongo-sh-01').className).toContain(styles.paneMuted);
    expect(screen.getByTestId('pane-mongo-sh-01').className).not.toContain(styles.paneArmed);
  });

  it('select-all / clear act on the active tab only', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));

    await user.click(screen.getByRole('tab', { name: /^data/ }));
    await user.click(screen.getByTestId('console-select-none'));
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('0 of 2');

    // The control tab must be untouched by a clear scoped to data.
    await user.click(screen.getByRole('tab', { name: /^control/ }));
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('1 of 1');
  });

  it('[INVARIANT] arming is per tab — unticking in one leaves the others armed', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));

    // Untick a shard while working in the data tab...
    await user.click(screen.getByRole('tab', { name: /^data/ }));
    await user.click(screen.getByTestId('pane-select-mongo-sh-01'));
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('1 of 2');

    // ...the All tab is a separate working context and keeps it armed.
    await user.click(screen.getByTestId('console-tab-all'));
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('4 of 4');
    await user.type(screen.getByTestId('console-broadcast-input'), 'uptime');
    await user.click(screen.getByTestId('console-broadcast-send'));
    expect(stdinTargets()).toContain('mongo-sh-01');
  });

  it('[INVARIANT] a tab send skips what was unticked in THAT tab', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));
    await user.click(screen.getByTestId('console-groups-done'));

    await user.click(screen.getByRole('tab', { name: /^data/ }));
    await user.click(screen.getByTestId('pane-select-mongo-sh-01'));
    await user.type(screen.getByTestId('console-broadcast-input'), 'systemctl restart mongod');
    await user.click(screen.getByTestId('console-broadcast-send'));

    expect(stdinTargets()).toEqual(['mongo-sh-02']);
  });

  it('[INVARIANT] warns and refuses to send when nothing is armed', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-select-none'));

    expect(screen.getByTestId('console-none-selected')).toBeInTheDocument();
    await user.type(screen.getByTestId('console-broadcast-input'), 'rm -rf /');
    expect(screen.getByTestId('console-broadcast-send')).toBeDisabled();
    expect(stdinTargets()).toEqual([]);
  });

  it('a VM attaching later is armed by default', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-select-none'));
    await user.click(screen.getByTestId('console-select-all'));
    expect(screen.getByTestId('console-selection-count')).toHaveTextContent('4 of 4');
  });
});

describe('MultiConsolePage — wall density', () => {
  it('offers font size, height and column controls', async () => {
    await connectScope();
    expect(screen.getByTestId('console-font-12')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('console-height-340')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('console-cols-3')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a smaller font is applied and remembered for next time', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-font-10'));
    expect(screen.getByTestId('console-font-10')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('soul-stack.console.view') ?? '{}')).toMatchObject({
      fontSize: 10,
    });
  });

  it('row height drives the wall, and is remembered', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-height-620'));
    expect(screen.getByTestId('console-wall')).toHaveStyle({ '--console-row-h': '620px' });
    expect(JSON.parse(localStorage.getItem('soul-stack.console.view') ?? '{}')).toMatchObject({
      rowHeight: 620,
    });
  });

  it('restores a stored density instead of the defaults', async () => {
    localStorage.setItem(
      'soul-stack.console.view',
      JSON.stringify({ columns: 2, fontSize: 16, rowHeight: 260 }),
    );
    await connectScope();
    expect(screen.getByTestId('console-cols-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('console-font-16')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('console-wall')).toHaveStyle({ '--console-row-h': '260px' });
  });
});

describe('MultiConsolePage — persisted groups', () => {
  it('restores groups written on a previous visit', async () => {
    localStorage.setItem(
      'soul-stack.console.groups',
      JSON.stringify([{ name: 'shards', query: 'trait.role = data' }]),
    );
    await connectScope();
    const tab = screen.getByRole('tab', { name: /^shards/ });
    expect(tab).toHaveTextContent('2');
  });

  it('persists groups as they are edited', async () => {
    const user = await connectScope();
    await user.click(screen.getByTestId('console-edit-groups'));
    await user.click(screen.getByTestId('console-autosplit-trait.role'));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('soul-stack.console.groups') ?? '[]');
      expect(stored.map((g: { name: string }) => g.name)).toEqual(['control', 'data']);
    });
  });
});

describe('MultiConsolePage — search', () => {
  it('counts matching consoles and can hide the rest', async () => {
    const user = await connectScope();
    serverChunk('mongo-ctl-01', 'PONG\r\n');
    serverChunk('mongo-sh-01', 'Connection refused\r\n');

    await user.type(screen.getByTestId('console-search'), 'refused');
    await waitFor(() => expect(screen.getByTestId('console-search-found')).toHaveTextContent('1'));

    await user.click(screen.getByTestId('console-only-matches'));
    expect(screen.getByTestId('pane-mongo-ctl-01').className).toContain(styles.paneHidden);
    expect(screen.getByTestId('pane-mongo-sh-01').className).not.toContain(styles.paneHidden);
  });

  it('[INVARIANT] the counter follows output arriving after the query was typed', async () => {
    const user = await connectScope();
    await user.type(screen.getByTestId('console-search'), 'refused');
    await waitFor(() => expect(screen.getByTestId('console-search-found')).toHaveTextContent('found in 0 of 4'));

    // Output bypasses React state by design; the sampling tick keeps this honest.
    serverChunk('mongo-sh-01', 'Connection refused\r\n');
    await waitFor(() => expect(screen.getByTestId('console-search-found')).toHaveTextContent('found in 1 of 4'));
  });
});

describe('MultiConsolePage — disconnect', () => {
  it('[INVARIANT] a dropped socket is surfaced, not hidden behind stale panes', async () => {
    await connectScope();
    act(() => hooks!.onClose({ code: 1006, reason: 'abnormal closure' }));

    const banner = await screen.findByTestId('console-disconnected-banner');
    expect(banner).toHaveTextContent('abnormal closure');
    expect(within(screen.getByTestId('pane-mongo-ctl-01')).getByTitle('closed')).toBeInTheDocument();
  });

  it('reconnect drops the old socket and re-attaches the same VMs', async () => {
    const user = await connectScope();
    act(() => hooks!.onClose({ code: 1006, reason: 'abnormal closure' }));

    sent.length = 0;
    await user.click(await screen.findByTestId('console-reconnect'));
    act(() => hooks!.onOpen());

    expect(socketClosed).toBe(true);
    const reopened = sent.filter((m) => m.type === 'open').map((m) => (m.type === 'open' ? m.sid : ''));
    expect(reopened).toEqual(['mongo-ctl-01', 'mongo-sh-01', 'mongo-sh-02', 'mongo-arb-01']);
  });

  it('the recording chip is gone from the command bar', async () => {
    await connectScope();
    expect(screen.queryByTestId('console-rbac-chip')).not.toBeInTheDocument();
  });

  it('[INVARIANT] never silently falls back to the browser-simulated shell', async () => {
    await connectScope();
    expect(screen.queryByTestId('console-mock-banner')).not.toBeInTheDocument();
  });
});
