import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSseFrames, subscribeRunEvents } from '../api/runEvents';
import { normalizeAuditTaskPayload } from '../pages/incarnations/taskRow';
import { tokenStore } from '../api/tokenStore';

describe('parseSseFrames', () => {
  it('парсит один кадр event/id/data', () => {
    const { frames, rest } = parseSseFrames('event: task.executed\nid: 01APPLY\ndata: {"sid":"h1"}\n\n');
    expect(rest).toBe('');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: 'task.executed', id: '01APPLY', data: '{"sid":"h1"}' });
  });

  it('пропускает heartbeat-комментарии (`:ok` / `:keepalive`) — кадр не эмитится', () => {
    const { frames } = parseSseFrames(':ok\n\n:keepalive\n\n');
    expect(frames).toHaveLength(0);
  });

  it('несколько кадров + heartbeat между ними', () => {
    const buf =
      ':ok\n\n' +
      'event: task.executed\ndata: {"sid":"a","task_idx":0}\n\n' +
      'event: apply.completed\ndata: {"sid":"a"}\n\n';
    const { frames, rest } = parseSseFrames(buf);
    expect(rest).toBe('');
    expect(frames.map((f) => f.event)).toEqual(['task.executed', 'apply.completed']);
  });

  it('незавершённый хвост возвращается в rest', () => {
    const { frames, rest } = parseSseFrames('event: task.executed\ndata: {"sid":"a"');
    expect(frames).toHaveLength(0);
    expect(rest).toBe('event: task.executed\ndata: {"sid":"a"');
  });

  it('склеивает буфер по границе чанка', () => {
    const a = parseSseFrames('event: task.executed\ndata: {"sid":"h1",');
    const b = parseSseFrames(a.rest + '"task_idx":2}\n\n');
    expect(b.frames).toHaveLength(1);
    expect(JSON.parse(b.frames[0].data)).toMatchObject({ sid: 'h1', task_idx: 2 });
  });

  it('default event = message если поля event нет', () => {
    const { frames } = parseSseFrames('data: {"x":1}\n\n');
    expect(frames[0].event).toBe('message');
  });
});

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

describe('subscribeRunEvents (fetch-streaming)', () => {
  beforeEach(() => tokenStore.clear());

  it('читает ReadableStream и эмитит распарсенные кадры (кадр→событие)', async () => {
    const events: string[] = [];
    const spy = vi.fn(
      async () =>
        new Response(
          streamFromChunks([
            ':ok\n\n',
            'event: task.executed\ndata: {"sid":"h1","task_idx":0,"task_status":"TASK_STATUS_OK","passage":0}\n\n',
            'event: apply.completed\ndata: {"sid":"h1"}\n\n',
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    await subscribeRunEvents('redis-prod', '01APPLY', {
      fetchImpl: spy as unknown as typeof fetch,
      onEvent: (f) => events.push(f.event),
    });
    expect(events).toEqual(['task.executed', 'apply.completed']);
  });

  it('Authorization: Bearer из tokenStore + Accept text/event-stream прокидываются; URL = events-роут', async () => {
    tokenStore.set('test-token');
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const spy = vi.fn((url: string, init?: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(new Response(streamFromChunks([]), { status: 200 }));
    });
    await subscribeRunEvents('redis-prod', '01APPLY', {
      fetchImpl: spy as unknown as typeof fetch,
      onEvent: () => {},
    });
    expect(seenUrl).toBe('/v1/incarnations/redis-prod/runs/01APPLY/events');
    const headers = (seenInit as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers.Accept).toBe('text/event-stream');
  });

  it('non-200 → onError (graceful fallback на polling)', async () => {
    const spy = vi.fn(async () => new Response('nope', { status: 403 }));
    const onError = vi.fn();
    await subscribeRunEvents('n', 'a', { fetchImpl: spy as unknown as typeof fetch, onEvent: () => {}, onError });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('fetch throws → onError', async () => {
    const spy = vi.fn(async () => {
      throw new Error('net');
    });
    const onError = vi.fn();
    await subscribeRunEvents('n', 'a', { fetchImpl: spy as unknown as typeof fetch, onEvent: () => {}, onError });
    expect(onError).toHaveBeenCalledOnce();
  });
});

// Audit normalization serves the graceful fallback timeline (backend /tasks isn't
// deployed yet). On the primary path (Schema-2) the server does the join -- SSE became a nudge,
// frames are no longer normalized into TaskRow.
describe('audit TaskRow normalization (fallback)', () => {
  it('normalizeAuditTaskPayload: status + plan_index + error.module; message ОТБРАСЫВАЕТСЯ (секрет-гигиена)', () => {
    const row = normalizeAuditTaskPayload({
      sid: 'h1',
      task_idx: 3,
      plan_index: 7,
      passage: 0,
      status: 'TASK_STATUS_CHANGED',
      error: { code: 'E', module: 'm', message: 'boom' },
    });
    expect(row).toMatchObject({
      sid: 'h1',
      taskIdx: 3,
      planIndex: 7,
      status: 'TASK_STATUS_CHANGED',
      errorModule: 'm',
    });
    // audit-message may carry a secret -- NOT forwarded to the frontend (not rendered).
    expect(row).not.toHaveProperty('errorMessage');
    expect(row).not.toHaveProperty('message');
  });

  it('невалидный payload (нет sid / null) → null', () => {
    expect(normalizeAuditTaskPayload({ task_idx: 0 })).toBeNull();
    expect(normalizeAuditTaskPayload(null)).toBeNull();
  });
});
