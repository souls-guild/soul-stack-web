// Wire protocol of the interactive multi-console (Keeper WS `/v1/console`).
//
// One socket multiplexes N console sessions, keyed by a client-generated
// `session_id`. Frames are JSON text; byte payloads (`data`) are base64 so a
// PTY stream stays binary-safe inside JSON. The shapes mirror the keeper<->soul
// proto oneofs 1:1 (console_open/stdin/resize/close, console_opened/chunk/exit),
// so Keeper only has to relay, not translate.
//
// This module is the single point that has to change if the server picks a
// different framing (e.g. binary WS frames): the transport and the session
// store speak these types, never raw strings.

// Subprotocol advertised on connect; the server must echo it back as the
// selected subprotocol. Auth rides alongside as `bearer.<jwt>` because the
// browser WebSocket API cannot set an Authorization header.
export const CONSOLE_SUBPROTOCOL = 'soul-stack.console.v1';
export const CONSOLE_BEARER_PREFIX = 'bearer.';

export type ConsoleStream = 'stdout' | 'stderr';

// --- client -> keeper ---

export interface ConsoleOpenMessage {
  type: 'open';
  session_id: string;
  sid: string;
  cols: number;
  rows: number;
  // Optional shell override; absent = the soul's default login shell.
  shell?: string;
}

export interface ConsoleStdinMessage {
  type: 'stdin';
  session_id: string;
  // base64 of the raw bytes typed by the operator.
  data: string;
}

export interface ConsoleResizeMessage {
  type: 'resize';
  session_id: string;
  cols: number;
  rows: number;
}

export interface ConsoleCloseMessage {
  type: 'close';
  session_id: string;
}

export type ConsoleClientMessage =
  | ConsoleOpenMessage
  | ConsoleStdinMessage
  | ConsoleResizeMessage
  | ConsoleCloseMessage;

// --- keeper -> client ---

export interface ConsoleOpenedMessage {
  type: 'opened';
  session_id: string;
  sid: string;
  pid?: number;
}

export interface ConsoleChunkMessage {
  type: 'chunk';
  session_id: string;
  stream: ConsoleStream;
  // base64 of the raw PTY bytes.
  data: string;
}

export interface ConsoleExitMessage {
  type: 'exit';
  session_id: string;
  code: number;
}

// Session-scoped when `session_id` is present (open refused, soul offline),
// socket-scoped otherwise (handshake/auth failures).
export interface ConsoleErrorMessage {
  type: 'error';
  session_id?: string;
  code: string;
  message: string;
}

export type ConsoleServerMessage =
  | ConsoleOpenedMessage
  | ConsoleChunkMessage
  | ConsoleExitMessage
  | ConsoleErrorMessage;

// --- base64 <-> bytes ---
//
// Hand-rolled instead of a codec dependency: this is the hot path of every PTY
// chunk. Chunked to keep String.fromCharCode off large spreads.

const B64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const slice = bytes.subarray(i, i + B64_CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();

// Operator keystrokes (xterm hands us a string) -> wire stdin frame.
export function encodeStdin(sessionId: string, data: string): ConsoleStdinMessage {
  return { type: 'stdin', session_id: sessionId, data: bytesToBase64(encoder.encode(data)) };
}

// --- validation ---
//
// Hand-rolled type guards rather than Zod: `chunk` arrives at PTY frequency and
// a schema parse per frame is measurable. Anything unrecognized is dropped
// (forward-compatible: a future message type must not break the wall).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function parseServerMessage(raw: unknown): ConsoleServerMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;

  const sessionId = value.session_id;
  switch (value.type) {
    case 'opened':
      if (typeof sessionId !== 'string' || typeof value.sid !== 'string') return null;
      return {
        type: 'opened',
        session_id: sessionId,
        sid: value.sid,
        ...(typeof value.pid === 'number' ? { pid: value.pid } : {}),
      };
    case 'chunk': {
      if (typeof sessionId !== 'string' || typeof value.data !== 'string') return null;
      const stream: ConsoleStream = value.stream === 'stderr' ? 'stderr' : 'stdout';
      return { type: 'chunk', session_id: sessionId, stream, data: value.data };
    }
    case 'exit':
      if (typeof sessionId !== 'string') return null;
      return { type: 'exit', session_id: sessionId, code: typeof value.code === 'number' ? value.code : 0 };
    case 'error':
      return {
        type: 'error',
        ...(typeof sessionId === 'string' ? { session_id: sessionId } : {}),
        code: typeof value.code === 'string' ? value.code : 'unknown',
        message: typeof value.message === 'string' ? value.message : '',
      };
    default:
      return null;
  }
}

// Session ids are client-generated so `open` can be correlated with `opened`
// without a round trip. randomUUID is absent in some non-secure contexts.
let sessionCounter = 0;
export function newSessionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  sessionCounter += 1;
  return `cs-${Date.now().toString(36)}-${sessionCounter}`;
}
