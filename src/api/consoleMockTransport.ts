// In-browser fake PTY, used ONLY when the operator opens the wall with
// `?transport=mock`. It exists so the console UI (attach/detach, broadcast,
// search, resize, disconnect) can be exercised before the Keeper WS endpoint
// ships, and so component tests get a deterministic peer.
//
// It is never selected automatically: a mock shell that silently stands in for
// a real host is the one failure mode worth engineering against. The page
// renders a permanent banner while it is active.

import {
  base64ToBytes,
  bytesToBase64,
  type ConsoleClientMessage,
  type ConsoleServerMessage,
} from './consoleProtocol';
import type { ConsoleTransport, ConsoleTransportHooks } from './consoleSocket';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD_GREEN = '\x1b[1;32m';

interface MockSession {
  sid: string;
  line: string;
  closed: boolean;
}

export interface MockTransportOptions {
  // Per-session connect delay. 0 in tests; a human-visible stagger in the demo.
  openDelayMs?: number;
  // Souls whose fake redis is down — gives the wall a failing host to look at.
  failingSids?: readonly string[];
  setTimeoutImpl?: typeof setTimeout;
}

function prompt(sid: string): string {
  const short = sid.split('.')[0];
  return `${BOLD_GREEN}root@${short}${RESET}:${DIM}~${RESET}# `;
}

// Deterministic 0..1 from the sid — a stagger that does not need Math.random
// (so a test run is reproducible).
function sidJitter(sid: string): number {
  let h = 0;
  for (let i = 0; i < sid.length; i += 1) h = (h * 31 + sid.charCodeAt(i)) % 997;
  return h / 997;
}

function fakeCommand(cmd: string, sid: string, failing: boolean): string[] {
  const c = cmd.trim();
  if (c === '') return [];
  if (c === 'whoami') return ['root'];
  if (c === 'pwd') return ['/root'];
  if (c === 'id') return ['uid=0(root) gid=0(root) groups=0(root)'];
  if (c === 'hostname' || c === 'hostname -f') return [sid];
  if (c === 'uptime') return [' 14:22:07 up 41 days,  3:19,  1 user,  load average: 0.18, 0.24, 0.21'];
  if (c.startsWith('echo ')) return [c.slice(5)];
  if (c === 'ls' || c.startsWith('ls ')) return ['bin  boot  dev  etc  home  lib  root  run  srv  usr  var'];
  if (c === 'stty size') return ['24 80'];
  if (c.startsWith('redis-cli ping')) {
    return failing
      ? [`${RED}Could not connect to Redis at /run/redis.sock: Connection refused${RESET}`]
      : [`${GREEN}PONG${RESET}`];
  }
  if (c.startsWith('systemctl status redis')) {
    return failing
      ? [
          '● redis-server.service - Advanced key-value store',
          `   Active: ${RED}failed (Result: exit-code)${RESET} since 14:07`,
        ]
      : [
          '● redis-server.service - Advanced key-value store',
          `   Active: ${GREEN}active (running)${RESET} since 09:41; 4h ago`,
          '   Memory: 218.4M',
        ];
  }
  return [`${DIM}-bash: ${c.split(' ')[0]}: command not found${RESET}`];
}

export function createMockTransport(
  hooks: ConsoleTransportHooks,
  opts: MockTransportOptions = {},
): ConsoleTransport {
  const delayBase = opts.openDelayMs ?? 700;
  const failing = new Set(opts.failingSids ?? []);
  const later = opts.setTimeoutImpl ?? setTimeout;
  const sessions = new Map<string, MockSession>();
  let alive = true;

  function emit(msg: ConsoleServerMessage): void {
    if (alive) hooks.onMessage(msg);
  }

  function write(sessionId: string, text: string): void {
    emit({
      type: 'chunk',
      session_id: sessionId,
      stream: 'stdout',
      data: bytesToBase64(encoder.encode(text)),
    });
  }

  function runLine(sessionId: string, s: MockSession): void {
    const cmd = s.line;
    s.line = '';
    write(sessionId, '\r\n');
    if (cmd.trim() === 'exit') {
      write(sessionId, `${DIM}logout${RESET}\r\n`);
      s.closed = true;
      emit({ type: 'exit', session_id: sessionId, code: 0 });
      return;
    }
    for (const out of fakeCommand(cmd, s.sid, failing.has(s.sid))) write(sessionId, `${out}\r\n`);
    write(sessionId, prompt(s.sid));
  }

  function handleStdin(sessionId: string, data: string): void {
    const s = sessions.get(sessionId);
    if (!s || s.closed) return;
    for (const ch of decoder.decode(base64ToBytes(data))) {
      if (ch === '\r' || ch === '\n') {
        runLine(sessionId, s);
        if (s.closed) return;
      } else if (ch === '\x7f' || ch === '\b') {
        if (s.line.length > 0) {
          s.line = s.line.slice(0, -1);
          write(sessionId, '\b \b');
        }
      } else if (ch === '\x03') {
        s.line = '';
        write(sessionId, `^C\r\n${prompt(s.sid)}`);
      } else if (ch >= ' ') {
        s.line += ch;
        write(sessionId, ch);
      }
    }
  }

  // Deferred so the caller has subscribed before the first byte lands.
  later(() => {
    if (alive) hooks.onOpen();
  }, 0);

  return {
    send(msg: ConsoleClientMessage) {
      if (!alive) return;
      switch (msg.type) {
        case 'open': {
          const s: MockSession = { sid: msg.sid, line: '', closed: false };
          sessions.set(msg.session_id, s);
          later(
            () => {
              if (!alive || !sessions.has(msg.session_id)) return;
              emit({ type: 'opened', session_id: msg.session_id, sid: msg.sid, pid: 1000 + Math.floor(sidJitter(msg.sid) * 8000) });
              write(msg.session_id, `${DIM}mock shell — no real host attached${RESET}\r\n${prompt(msg.sid)}`);
            },
            delayBase === 0 ? 0 : delayBase + sidJitter(msg.sid) * delayBase,
          );
          break;
        }
        case 'stdin':
          handleStdin(msg.session_id, msg.data);
          break;
        case 'resize':
          break;
        case 'close': {
          const s = sessions.get(msg.session_id);
          sessions.delete(msg.session_id);
          if (s && !s.closed) emit({ type: 'exit', session_id: msg.session_id, code: 0 });
          break;
        }
      }
    },
    close() {
      alive = false;
      sessions.clear();
      hooks.onClose({ code: 1000, reason: 'mock closed' });
    },
  };
}
