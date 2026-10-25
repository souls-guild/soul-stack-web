// WebSocket transport for the multi-console (Keeper `/v1/console`).
//
// SSE (src/api/runEvents.ts) is one-way and cannot carry stdin, hence a real
// socket. Auth is the same gap as SSE: the browser WebSocket API sends no
// Authorization header, so the Bearer token travels as a second subprotocol
// (`bearer.<jwt>`) instead of a query parameter — subprotocols are not written
// to access logs or the Referer header the way a query string is.
//
// No auto-reconnect by design: Keeper kills the PTY when the socket drops, so a
// silent reconnect would produce fresh shells that look like the old ones. The
// page surfaces the drop and re-attaches explicitly.

import { tokenStore } from './tokenStore';
import { freshBearer, rawChannelRefused } from './client';
import {
  CONSOLE_BEARER_PREFIX,
  CONSOLE_SUBPROTOCOL,
  parseServerMessage,
  type ConsoleClientMessage,
  type ConsoleServerMessage,
} from './consoleProtocol';

export interface ConsoleTransportHooks {
  onOpen: () => void;
  onMessage: (msg: ConsoleServerMessage) => void;
  onClose: (info: { code: number; reason: string }) => void;
  onError: () => void;
}

export interface ConsoleTransport {
  send: (msg: ConsoleClientMessage) => void;
  close: () => void;
}

// Injected by the page so tests and the `?transport=mock` demo mode can swap the
// wire without touching the session store.
export type ConsoleTransportFactory = (hooks: ConsoleTransportHooks) => ConsoleTransport;

// `/v1/console` on the current origin. In dev the vite proxy forwards the
// upgrade to VITE_KEEPER_API; in prod the UI is served by Keeper itself.
export function consoleSocketUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/v1/console`;
}

export interface WebSocketTransportOptions {
  url?: string;
  token?: string | null;
  // Constructor injection for tests.
  socketImpl?: typeof WebSocket;
}

export function createWebSocketTransport(
  hooks: ConsoleTransportHooks,
  opts: WebSocketTransportOptions = {},
): ConsoleTransport {
  const Impl = opts.socketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let closed = false;
  // Frames produced before the socket finished opening (the wall attaches as
  // soon as the operator picks souls) would throw on send — hold them here.
  let pending: ConsoleClientMessage[] | null = [];

  const open = (token: string | null) => {
    if (closed) return;
    const protocols = token ? [CONSOLE_SUBPROTOCOL, `${CONSOLE_BEARER_PREFIX}${token}`] : [CONSOLE_SUBPROTOCOL];
    const socket = new Impl(opts.url ?? consoleSocketUrl(), protocols);
    ws = socket;
    // Chunks arrive as text frames today; a binary frame would otherwise surface
    // as a Blob and need an async read before parsing.
    socket.binaryType = 'arraybuffer';
    let opened = false;
    socket.onopen = () => {
      opened = true;
      const queued = pending ?? [];
      pending = null;
      hooks.onOpen();
      for (const msg of queued) socket.send(JSON.stringify(msg));
    };
    socket.onmessage = (ev: MessageEvent) => {
      const parsed = parseServerMessage(
        typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer),
      );
      if (parsed) hooks.onMessage(parsed);
    };
    socket.onerror = () => hooks.onError();
    socket.onclose = (ev: CloseEvent) => {
      pending = null;
      // A handshake that never opened is how the browser reports Keeper
      // refusing the Bearer — it shows no status, so any other failure to open
      // reads the same and costs one exchange (on top of the one freshBearer
      // made for a stale Bearer). Nothing reopens a socket without a click, so
      // the cost stays per attempt.
      if (!opened && !closed && opts.token === undefined) rawChannelRefused();
      hooks.onClose({ code: ev.code, reason: ev.reason });
    };
  };

  // The handshake has no 401 retry: a cookie session's Bearer comes from
  // freshBearer, and a refusal is reported back. An explicit token (tests) is
  // used as given.
  if (opts.token !== undefined) open(opts.token);
  else void freshBearer().then(open, () => open(tokenStore.get()));

  return {
    send(msg) {
      if (pending) {
        pending.push(msg);
        return;
      }
      if (ws && ws.readyState === Impl.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      pending = null;
      // 1000 = normal closure; Keeper reaps every PTY bound to this socket.
      if (ws && (ws.readyState === Impl.OPEN || ws.readyState === Impl.CONNECTING)) ws.close(1000, 'client closed');
    },
  };
}
