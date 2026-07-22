// Fetch-streaming SSE transport for run apply-events (NIM-37, ADR-069 A0).
//
// EventSource is NOT used: it cannot send an Authorization header, and
// the events route authenticates via Bearer (tokenStore). Hence a manual
// fetch + ReadableStream.getReader() + TextDecoder + custom SSE parser.
//
// Graceful: any fetch failure / non-200 / missing body → onError, and the
// calling component degrades to polling (GET runDetail remains the status authority).

import { tokenStore } from './tokenStore';

export interface SseFrame {
  event: string;
  id?: string;
  data: string;
}

// parseSseFrames — a pure incremental SSE frame parser. Returns
// completed frames and `rest` (the unfinished tail for the next chunk).
// Frames are separated by `\n\n`. A line starting with `:` is a comment (heartbeat
// `:ok`/`:keepalive`) → a frame with no data is not emitted. CRLF/CR are normalized to LF.
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const block of parts) {
    let event = 'message';
    let id: string | undefined;
    let data: string | undefined;
    for (const line of block.split('\n')) {
      if (line === '') continue;
      if (line.startsWith(':')) continue; // comment/heartbeat
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1); // SSE: one leading space
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data = data === undefined ? value : `${data}\n${value}`;
    }
    if (data !== undefined) frames.push({ event, id, data });
  }
  return { frames, rest };
}

export interface SubscribeRunEventsOptions {
  onEvent: (frame: SseFrame) => void;
  onError?: (err: unknown) => void;
  onOpen?: () => void;
  signal?: AbortSignal;
  // fetch injection for tests; defaults to the global fetch.
  fetchImpl?: typeof fetch;
}

// subscribeRunEvents opens the run's SSE stream and calls onEvent for each
// parsed frame. Resolves once the stream closes (terminal / abort / error).
export async function subscribeRunEvents(
  name: string,
  applyId: string,
  opts: SubscribeRunEventsOptions,
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `/v1/incarnations/${encodeURIComponent(name)}/runs/${encodeURIComponent(applyId)}/events`;

  let res: Response;
  try {
    res = await doFetch(url, { headers, signal: opts.signal });
  } catch (err) {
    if (!opts.signal?.aborted) opts.onError?.(err);
    return;
  }

  if (!res.ok || !res.body) {
    opts.onError?.(new Error(`sse status ${res.status}`));
    return;
  }

  opts.onOpen?.();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseFrames(buf);
      buf = rest;
      for (const frame of frames) opts.onEvent(frame);
    }
  } catch (err) {
    if (!opts.signal?.aborted) opts.onError?.(err);
  }
}
