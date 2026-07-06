// Fetch-streaming SSE-транспорт apply-событий прогона (NIM-37, ADR-069 A0).
//
// EventSource НЕ используется: он не умеет слать Authorization-header, а
// events-роут аутентифицируется Bearer-ом (tokenStore). Поэтому — ручной
// fetch + ReadableStream.getReader() + TextDecoder + собственный SSE-парсер.
//
// Graceful: любой fetch-fail / non-200 / отсутствие body → onError, вызывающий
// компонент деградирует на polling (авторитет статуса — GET runDetail).

import { tokenStore } from './tokenStore';

export interface SseFrame {
  event: string;
  id?: string;
  data: string;
}

// parseSseFrames — чистый инкрементальный парсер SSE-кадров. Возвращает
// завершённые кадры и `rest` (незавершённый хвост для следующего чанка).
// Кадры разделены `\n\n`. Строка на `:` — комментарий (heartbeat `:ok`/
// `:keepalive`) → кадр без data не эмитим. CRLF/CR нормализуются в LF.
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
      if (line.startsWith(':')) continue; // комментарий/heartbeat
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1); // SSE: один ведущий пробел
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
  // Инъекция fetch для тестов; по умолчанию — глобальный fetch.
  fetchImpl?: typeof fetch;
}

// subscribeRunEvents открывает SSE-стрим прогона и вызывает onEvent на каждый
// распарсенный кадр. Резолвится, когда стрим закрыт (терминал / abort / ошибка).
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
