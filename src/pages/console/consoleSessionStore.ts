// Session store for the multi-console wall: owns one transport and the N
// console sessions multiplexed over it.
//
// Deliberately framework-free. PTY bytes must not travel through React state —
// a busy `tail -f` would re-render the whole wall per chunk — so output is
// pushed straight to per-session subscribers (the xterm views) while React only
// re-renders on status transitions.

import {
  encodeStdin,
  base64ToBytes,
  newSessionId,
  type ConsoleServerMessage,
} from '../../api/consoleProtocol';
import type { ConsoleTransport, ConsoleTransportFactory } from '../../api/consoleSocket';

export type SocketState = 'connecting' | 'open' | 'closed';
export type SessionStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface ConsoleSession {
  sid: string;
  sessionId: string;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  // Populated for status='error' and for sessions cut short by a socket drop.
  error: string | null;
}

export interface ConsoleStoreSnapshot {
  socket: SocketState;
  socketError: string | null;
  sessions: ConsoleSession[];
}

// Until a pane has measured itself; Keeper/soul get the real size from the
// first resize frame the xterm view sends after fit().
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

// Replay buffer per session: what a pane mounting late (layout change, focus
// toggle) gets written into its terminal. Bounded so a runaway process cannot
// grow the tab without limit.
const DEFAULT_REPLAY_BYTES = 256 * 1024;
// Plain-text mirror per session — backs the cross-pane search, which xterm's
// per-terminal SearchAddon cannot answer ("found in N of M consoles").
const DEFAULT_SEARCH_CHARS = 200_000;

type OutputListener = (bytes: Uint8Array) => void;

interface Size {
  cols: number;
  rows: number;
}

interface SessionRuntime {
  session: ConsoleSession;
  replay: Uint8Array[];
  replayBytes: number;
  // Streaming decoder: a multi-byte rune split across two PTY chunks must not
  // corrupt the search mirror.
  decoder: TextDecoder;
  text: string;
  listeners: Set<OutputListener>;
  // What the pane last measured vs. what the far side was told. The pane fits
  // itself while the session is still connecting, so the measurement has to be
  // held and replayed on `opened` — otherwise the PTY stays at 80x24 and every
  // full-screen program (top, vim) renders to the wrong geometry.
  measured: Size | null;
  acked: Size;
}

export interface ConsoleSessionStoreOptions {
  replayBytes?: number;
  searchChars?: number;
}

export class ConsoleSessionStore {
  private transport: ConsoleTransport | null = null;
  private readonly factory: ConsoleTransportFactory;
  private readonly replayCap: number;
  private readonly searchCap: number;
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly bySessionId = new Map<string, string>();
  private order: string[] = [];
  private socket: SocketState = 'connecting';
  private socketError: string | null = null;
  private snapshot: ConsoleStoreSnapshot;
  private readonly watchers = new Set<() => void>();
  private disposed = false;

  constructor(factory: ConsoleTransportFactory, opts: ConsoleSessionStoreOptions = {}) {
    this.factory = factory;
    this.replayCap = opts.replayBytes ?? DEFAULT_REPLAY_BYTES;
    this.searchCap = opts.searchChars ?? DEFAULT_SEARCH_CHARS;
    this.snapshot = { socket: 'connecting', socketError: null, sessions: [] };
    this.connect();
  }

  // --- external-store plumbing ---

  subscribe = (cb: () => void): (() => void) => {
    this.watchers.add(cb);
    return () => this.watchers.delete(cb);
  };

  getSnapshot = (): ConsoleStoreSnapshot => this.snapshot;

  private publish(): void {
    this.snapshot = {
      socket: this.socket,
      socketError: this.socketError,
      sessions: this.order.map((sid) => ({ ...this.runtimes.get(sid)!.session })),
    };
    for (const w of this.watchers) w();
  }

  // --- transport lifecycle ---

  private connect(): void {
    this.socket = 'connecting';
    this.socketError = null;
    this.transport = this.factory({
      onOpen: () => {
        this.socket = 'open';
        this.publish();
      },
      onMessage: (msg) => this.handle(msg),
      onClose: ({ code, reason }) => {
        this.socket = 'closed';
        if (!this.socketError && code !== 1000) {
          this.socketError = reason || `socket closed (${code})`;
        }
        // Keeper reaps every PTY bound to the socket, so no session survives it.
        for (const rt of this.runtimes.values()) {
          if (rt.session.status !== 'closed' && rt.session.status !== 'error') {
            rt.session = { ...rt.session, status: 'closed', error: 'connection lost' };
          }
        }
        this.publish();
      },
      onError: () => {
        this.socketError = 'socket error';
        this.publish();
      },
    });
  }

  // Drops the socket and re-opens every session that was attached. Sessions are
  // NOT resumed — Keeper killed those PTYs — so this yields fresh shells.
  reconnect(): void {
    if (this.disposed) return;
    this.transport?.close();
    const sids = [...this.order];
    this.runtimes.clear();
    this.bySessionId.clear();
    this.order = [];
    this.connect();
    for (const sid of sids) this.attach(sid);
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
    this.transport?.close();
    this.transport = null;
    this.runtimes.clear();
    this.bySessionId.clear();
    this.order = [];
    this.watchers.clear();
  }

  // --- selection ---

  attach(sid: string): void {
    if (this.disposed) return;
    const existing = this.runtimes.get(sid);
    if (existing && existing.session.status !== 'closed' && existing.session.status !== 'error') return;
    if (existing) this.dropRuntime(sid);

    const sessionId = newSessionId();
    const rt: SessionRuntime = {
      session: { sid, sessionId, status: 'connecting', pid: null, exitCode: null, error: null },
      replay: [],
      replayBytes: 0,
      decoder: new TextDecoder(),
      text: '',
      listeners: new Set(),
      measured: null,
      acked: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    };
    this.runtimes.set(sid, rt);
    this.bySessionId.set(sessionId, sid);
    if (!this.order.includes(sid)) this.order.push(sid);
    this.transport?.send({ type: 'open', session_id: sessionId, sid, cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    this.publish();
  }

  detach(sid: string): void {
    const rt = this.runtimes.get(sid);
    if (!rt) return;
    if (rt.session.status === 'connecting' || rt.session.status === 'open') {
      this.transport?.send({ type: 'close', session_id: rt.session.sessionId });
    }
    this.dropRuntime(sid);
    this.order = this.order.filter((s) => s !== sid);
    this.publish();
  }

  // Reconciles the wall against a new selection: attach what is missing, detach
  // what left. Used by the live picker.
  setSelection(sids: readonly string[]): void {
    const next = new Set(sids);
    for (const sid of [...this.order]) if (!next.has(sid)) this.detach(sid);
    for (const sid of sids) this.attach(sid);
  }

  private dropRuntime(sid: string): void {
    const rt = this.runtimes.get(sid);
    if (!rt) return;
    this.bySessionId.delete(rt.session.sessionId);
    rt.listeners.clear();
    this.runtimes.delete(sid);
  }

  // --- input ---

  sendInput(sid: string, data: string): void {
    const rt = this.runtimes.get(sid);
    if (!rt || rt.session.status !== 'open') return;
    this.transport?.send(encodeStdin(rt.session.sessionId, data));
  }

  // One command line into live sessions. `targets` restricts the blast radius to
  // a group (Choir); omit it for every attached console. An EMPTY targets array
  // sends to nothing — it must never be read as "unrestricted", since that would
  // turn a group that lost its hosts into a wall-wide broadcast.
  // Returns how many sessions got it, so the UI can report a real count.
  broadcast(line: string, targets?: readonly string[]): number {
    const allowed = targets === undefined ? null : new Set(targets);
    let sent = 0;
    for (const sid of this.order) {
      if (allowed && !allowed.has(sid)) continue;
      const rt = this.runtimes.get(sid);
      if (!rt || rt.session.status !== 'open') continue;
      this.transport?.send(encodeStdin(rt.session.sessionId, `${line}\r`));
      sent += 1;
    }
    return sent;
  }

  resize(sid: string, cols: number, rows: number): void {
    const rt = this.runtimes.get(sid);
    if (!rt || cols <= 0 || rows <= 0) return;
    rt.measured = { cols, rows };
    this.flushSize(rt);
  }

  private flushSize(rt: SessionRuntime): void {
    const size = rt.measured;
    if (!size || rt.session.status !== 'open') return;
    if (size.cols === rt.acked.cols && size.rows === rt.acked.rows) return;
    rt.acked = size;
    this.transport?.send({ type: 'resize', session_id: rt.session.sessionId, cols: size.cols, rows: size.rows });
  }

  // --- output ---

  // Subscribing synchronously replays the buffer first, so a pane remounting
  // mid-stream cannot miss bytes between replay and subscription.
  subscribeOutput(sid: string, cb: OutputListener): () => void {
    const rt = this.runtimes.get(sid);
    if (!rt) return () => {};
    for (const chunk of rt.replay) cb(chunk);
    rt.listeners.add(cb);
    return () => {
      rt.listeners.delete(cb);
    };
  }

  textOf(sid: string): string {
    return this.runtimes.get(sid)?.text ?? '';
  }

  private handle(msg: ConsoleServerMessage): void {
    if (msg.type === 'error' && !msg.session_id) {
      this.socketError = msg.message || msg.code;
      this.publish();
      return;
    }
    const sid = msg.session_id ? this.bySessionId.get(msg.session_id) : undefined;
    if (!sid) return; // stale session (detached mid-flight) — drop.
    const rt = this.runtimes.get(sid);
    if (!rt) return;

    switch (msg.type) {
      case 'opened':
        rt.session = { ...rt.session, status: 'open', pid: msg.pid ?? null };
        // The pane measured itself while this was still connecting.
        this.flushSize(rt);
        this.publish();
        break;
      case 'chunk': {
        const bytes = base64ToBytes(msg.data);
        this.appendReplay(rt, bytes);
        rt.text += rt.decoder.decode(bytes, { stream: true });
        if (rt.text.length > this.searchCap) rt.text = rt.text.slice(-this.searchCap);
        for (const listener of rt.listeners) listener(bytes);
        break;
      }
      case 'exit':
        rt.session = { ...rt.session, status: 'closed', exitCode: msg.code };
        this.publish();
        break;
      case 'error':
        rt.session = { ...rt.session, status: 'error', error: msg.message || msg.code };
        this.publish();
        break;
    }
  }

  private appendReplay(rt: SessionRuntime, bytes: Uint8Array): void {
    rt.replay.push(bytes);
    rt.replayBytes += bytes.length;
    while (rt.replayBytes > this.replayCap && rt.replay.length > 1) {
      rt.replayBytes -= rt.replay.shift()!.length;
    }
  }
}
