/**
 * NIM-146: session store of the multi-console wall.
 *
 * Guards the lifecycle rules the UI depends on:
 *  - one session per soul, attach/detach reconciled against the live selection;
 *  - broadcast reaches only sessions that are actually open;
 *  - a socket drop marks every session dead (Keeper reaps the PTYs, so a pane
 *    still showing "attached" would be a lie);
 *  - subscribing replays buffered output, so a remounted pane keeps its history.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  bytesToBase64,
  type ConsoleClientMessage,
  type ConsoleServerMessage,
} from '../api/consoleProtocol';
import type { ConsoleTransport, ConsoleTransportHooks } from '../api/consoleSocket';
import { ConsoleSessionStore } from '../pages/console/consoleSessionStore';

const encoder = new TextEncoder();

class FakeTransport implements ConsoleTransport {
  sent: ConsoleClientMessage[] = [];
  closed = false;
  constructor(private readonly hooks: ConsoleTransportHooks) {}
  send(msg: ConsoleClientMessage) {
    this.sent.push(msg);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.hooks.onOpen();
  }
  emit(msg: ConsoleServerMessage) {
    this.hooks.onMessage(msg);
  }
  drop(code = 1006, reason = 'abnormal') {
    this.hooks.onClose({ code, reason });
  }
  sessionIdFor(sid: string): string {
    const open = this.sent.find((m) => m.type === 'open' && m.sid === sid);
    if (!open || open.type !== 'open') throw new Error(`no open frame for ${sid}`);
    return open.session_id;
  }
}

let transports: FakeTransport[] = [];
function makeStore() {
  const store = new ConsoleSessionStore((hooks) => {
    const tr = new FakeTransport(hooks);
    transports.push(tr);
    return tr;
  });
  return { store, transport: () => transports[transports.length - 1] };
}

function attachAndOpen(store: ConsoleSessionStore, tr: FakeTransport, sid: string) {
  store.attach(sid);
  tr.emit({ type: 'opened', session_id: tr.sessionIdFor(sid), sid });
}

beforeEach(() => {
  transports = [];
});

describe('ConsoleSessionStore — attach / detach', () => {
  it('attaching sends open and lands in connecting until the soul answers', () => {
    const { store, transport } = makeStore();
    transport().open();
    store.attach('h1');

    expect(transport().sent).toEqual([
      expect.objectContaining({ type: 'open', sid: 'h1', cols: 80, rows: 24 }),
    ]);
    expect(store.getSnapshot().sessions).toEqual([expect.objectContaining({ sid: 'h1', status: 'connecting' })]);

    transport().emit({ type: 'opened', session_id: transport().sessionIdFor('h1'), sid: 'h1', pid: 77 });
    expect(store.getSnapshot().sessions[0]).toMatchObject({ status: 'open', pid: 77 });
  });

  it('attaching the same soul twice does not open a second session', () => {
    const { store, transport } = makeStore();
    transport().open();
    store.attach('h1');
    store.attach('h1');
    expect(transport().sent.filter((m) => m.type === 'open')).toHaveLength(1);
    expect(store.getSnapshot().sessions).toHaveLength(1);
  });

  it('detach sends close and removes the pane', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    const sessionId = transport().sessionIdFor('h1');

    store.detach('h1');
    expect(transport().sent).toContainEqual({ type: 'close', session_id: sessionId });
    expect(store.getSnapshot().sessions).toHaveLength(0);
  });

  it('setSelection reconciles the wall: attaches new souls, detaches dropped ones', () => {
    const { store, transport } = makeStore();
    transport().open();
    store.setSelection(['h1', 'h2']);
    expect(store.getSnapshot().sessions.map((s) => s.sid)).toEqual(['h1', 'h2']);

    store.setSelection(['h2', 'h3']);
    expect(store.getSnapshot().sessions.map((s) => s.sid)).toEqual(['h2', 'h3']);
  });
});

describe('ConsoleSessionStore — output', () => {
  it('subscribing replays buffered chunks, then streams live ones', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    const sessionId = transport().sessionIdFor('h1');

    transport().emit({ type: 'chunk', session_id: sessionId, stream: 'stdout', data: bytesToBase64(encoder.encode('past ')) });

    const seen: string[] = [];
    const off = store.subscribeOutput('h1', (bytes) => seen.push(new TextDecoder().decode(bytes)));
    expect(seen).toEqual(['past ']);

    transport().emit({ type: 'chunk', session_id: sessionId, stream: 'stdout', data: bytesToBase64(encoder.encode('live')) });
    expect(seen).toEqual(['past ', 'live']);

    off();
    transport().emit({ type: 'chunk', session_id: sessionId, stream: 'stdout', data: bytesToBase64(encoder.encode('after')) });
    expect(seen).toEqual(['past ', 'live']);
  });

  it('mirrors output as text for cross-pane search, re-joining split UTF-8 runes', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    const sessionId = transport().sessionIdFor('h1');

    // 'ё' is two bytes — deliver them in separate chunks, as a PTY may.
    const rune = encoder.encode('ё');
    transport().emit({ type: 'chunk', session_id: sessionId, stream: 'stdout', data: bytesToBase64(rune.subarray(0, 1)) });
    transport().emit({ type: 'chunk', session_id: sessionId, stream: 'stdout', data: bytesToBase64(rune.subarray(1)) });

    expect(store.textOf('h1')).toBe('ё');
  });
});

describe('ConsoleSessionStore — input', () => {
  it('broadcast reaches only open sessions and reports the count', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    store.attach('h2'); // still connecting

    const sent = store.broadcast('uptime');
    expect(sent).toBe(1);
    const stdin = transport().sent.filter((m) => m.type === 'stdin');
    expect(stdin).toHaveLength(1);
    expect(stdin[0].session_id).toBe(transport().sessionIdFor('h1'));
  });

  it('[INVARIANT] a scoped broadcast reaches only the named sessions', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'ctl-01');
    attachAndOpen(store, transport(), 'sh-01');
    attachAndOpen(store, transport(), 'sh-02');

    const sent = store.broadcast('systemctl restart mongod', ['sh-01', 'sh-02']);
    expect(sent).toBe(2);
    const reached = transport()
      .sent.filter((m) => m.type === 'stdin')
      .map((m) => m.session_id);
    expect(reached).toEqual([transport().sessionIdFor('sh-01'), transport().sessionIdFor('sh-02')]);
    expect(reached).not.toContain(transport().sessionIdFor('ctl-01'));
  });

  it('[INVARIANT] an empty target list sends to nothing, never to everything', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'ctl-01');
    attachAndOpen(store, transport(), 'sh-01');

    // A group that lost all its hosts must not silently become a wall-wide blast.
    expect(store.broadcast('rm -rf /data', [])).toBe(0);
    expect(transport().sent.filter((m) => m.type === 'stdin')).toHaveLength(0);
  });

  it('an omitted target list still means every attached console', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'ctl-01');
    attachAndOpen(store, transport(), 'sh-01');
    expect(store.broadcast('uptime')).toBe(2);
  });

  it('a scoped broadcast still skips sessions that are not open', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'sh-01');
    store.attach('sh-02'); // connecting
    expect(store.broadcast('uptime', ['sh-01', 'sh-02'])).toBe(1);
  });

  it('per-pane input is dropped while a session is not open', () => {
    const { store, transport } = makeStore();
    transport().open();
    store.attach('h1');
    store.sendInput('h1', 'x');
    expect(transport().sent.filter((m) => m.type === 'stdin')).toHaveLength(0);
  });

  it('[INVARIANT] a size measured while connecting is delivered once the session opens', () => {
    const { store, transport } = makeStore();
    transport().open();
    store.attach('h1');
    // The pane fits itself as soon as it mounts — long before the soul answers.
    store.resize('h1', 132, 43);
    expect(transport().sent.filter((m) => m.type === 'resize')).toHaveLength(0);

    transport().emit({ type: 'opened', session_id: transport().sessionIdFor('h1'), sid: 'h1' });
    expect(transport().sent).toContainEqual(
      expect.objectContaining({ type: 'resize', cols: 132, rows: 43 }),
    );
  });

  it('resends only on a real geometry change, not on every refit', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');

    store.resize('h1', 100, 30);
    store.resize('h1', 100, 30);
    store.resize('h1', 120, 30);
    expect(transport().sent.filter((m) => m.type === 'resize')).toHaveLength(2);

    // A degenerate measurement from a hidden pane must not reach the PTY.
    store.resize('h1', 0, 0);
    expect(transport().sent.filter((m) => m.type === 'resize')).toHaveLength(2);
  });
});

describe('ConsoleSessionStore — failure surfaces', () => {
  it('exit keeps the pane and records the code', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    transport().emit({ type: 'exit', session_id: transport().sessionIdFor('h1'), code: 1 });

    expect(store.getSnapshot().sessions[0]).toMatchObject({ status: 'closed', exitCode: 1 });
  });

  it('a session-scoped error (RBAC deny) marks only that pane', () => {
    const { store, transport } = makeStore();
    transport().open();
    store.attach('h1');
    store.attach('h2');
    transport().emit({
      type: 'error',
      session_id: transport().sessionIdFor('h2'),
      code: 'forbidden',
      message: 'soul.console denied',
    });

    const sessions = store.getSnapshot().sessions;
    expect(sessions.find((s) => s.sid === 'h2')).toMatchObject({ status: 'error', error: 'soul.console denied' });
    expect(sessions.find((s) => s.sid === 'h1')).toMatchObject({ status: 'connecting' });
  });

  it('[INVARIANT] a socket drop marks every live session closed', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    store.attach('h2');

    transport().drop();

    const snap = store.getSnapshot();
    expect(snap.socket).toBe('closed');
    expect(snap.socketError).toBe('abnormal');
    expect(snap.sessions.every((s) => s.status === 'closed' && s.error === 'connection lost')).toBe(true);
  });

  it('reconnect opens a new socket and re-attaches the same souls as fresh sessions', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    const firstSessionId = store.getSnapshot().sessions[0].sessionId;
    transport().drop();

    store.reconnect();
    expect(transports).toHaveLength(2);
    expect(transports[0].closed).toBe(true);

    const snap = store.getSnapshot();
    expect(snap.sessions.map((s) => s.sid)).toEqual(['h1']);
    expect(snap.sessions[0].status).toBe('connecting');
    expect(snap.sessions[0].sessionId).not.toBe(firstSessionId);
  });

  it('ignores frames for a session that was already detached', () => {
    const { store, transport } = makeStore();
    transport().open();
    attachAndOpen(store, transport(), 'h1');
    const sessionId = transport().sessionIdFor('h1');
    store.detach('h1');

    expect(() =>
      transport().emit({ type: 'chunk', session_id: sessionId, stream: 'stdout', data: bytesToBase64(encoder.encode('x')) }),
    ).not.toThrow();
    expect(store.getSnapshot().sessions).toHaveLength(0);
  });
});
