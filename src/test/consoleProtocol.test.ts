/**
 * NIM-146: wire contract of the multi-console WS.
 *
 * The invariant under test is binary safety: a PTY carries arbitrary bytes
 * (ANSI escapes, UTF-8 runes, NUL), and JSON cannot. A regression to putting
 * raw strings on the wire would corrupt terminal output in ways that look like
 * a backend bug.
 */
import { describe, it, expect } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  encodeStdin,
  newSessionId,
  parseServerMessage,
} from '../api/consoleProtocol';

describe('console protocol — base64 framing', () => {
  it('round-trips arbitrary bytes, including NUL and high bytes', () => {
    const bytes = new Uint8Array([0, 1, 27, 91, 50, 74, 255, 128, 10, 13]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips multi-byte UTF-8 through stdin encoding', () => {
    const msg = encodeStdin('s1', 'привет ✅\r');
    expect(new TextDecoder().decode(base64ToBytes(msg.data))).toBe('привет ✅\r');
    expect(msg.type).toBe('stdin');
    expect(msg.session_id).toBe('s1');
  });

  it('survives payloads larger than one fromCharCode chunk', () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('console protocol — parseServerMessage', () => {
  it('parses opened / chunk / exit / error', () => {
    expect(parseServerMessage('{"type":"opened","session_id":"s1","sid":"h1","pid":42}')).toEqual({
      type: 'opened',
      session_id: 's1',
      sid: 'h1',
      pid: 42,
    });
    expect(parseServerMessage({ type: 'chunk', session_id: 's1', stream: 'stderr', data: 'aGk=' })).toEqual({
      type: 'chunk',
      session_id: 's1',
      stream: 'stderr',
      data: 'aGk=',
    });
    expect(parseServerMessage({ type: 'exit', session_id: 's1', code: 1 })).toEqual({
      type: 'exit',
      session_id: 's1',
      code: 1,
    });
    expect(parseServerMessage({ type: 'error', code: 'forbidden', message: 'no soul.console' })).toEqual({
      type: 'error',
      code: 'forbidden',
      message: 'no soul.console',
    });
  });

  it('defaults an unknown stream to stdout rather than dropping output', () => {
    const parsed = parseServerMessage({ type: 'chunk', session_id: 's1', data: 'aGk=' });
    expect(parsed).toMatchObject({ stream: 'stdout' });
  });

  it('drops malformed and unknown frames instead of throwing', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage({ type: 'chunk', session_id: 's1' })).toBeNull();
    expect(parseServerMessage({ type: 'opened', sid: 'h1' })).toBeNull();
    // Forward-compatibility: a message type added later must not break the wall.
    expect(parseServerMessage({ type: 'console_metrics', session_id: 's1' })).toBeNull();
  });
});

describe('console protocol — session ids', () => {
  it('are unique per call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSessionId()));
    expect(ids.size).toBe(50);
  });
});
