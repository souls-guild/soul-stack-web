import { type APIRequestContext, type APIResponse, request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEPER = process.env.SMOKE_KEEPER_API ?? 'http://127.0.0.1:8080';

function readToken(): string {
  const fromEnv = process.env.SMOKE_JWT?.trim();
  if (fromEnv) return fromEnv;
  return readFileSync(resolve(HERE, '..', '.auth', 'token.txt'), 'utf8').trim();
}

export type SoulTransport = 'agent' | 'ssh';

export interface CreateIncarnationBody {
  name: string;
  service: string;
  create_scenario?: string;
  input?: Record<string, unknown>;
  covens?: string[];
  traits?: Record<string, unknown>;
}

// Тонкая обёртка Operator API (:8080, Bearer из token.txt/SMOKE_JWT) для засева/уборки.
export class SmokeApi {
  private constructor(private ctx: APIRequestContext) {}

  static async create(): Promise<SmokeApi> {
    const ctx = await request.newContext({
      baseURL: KEEPER,
      extraHTTPHeaders: {
        Authorization: `Bearer ${readToken()}`,
        'Content-Type': 'application/json',
      },
    });
    return new SmokeApi(ctx);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  // ── souls ──────────────────────────────────────────────────────────────────
  registerSoul(sid: string, transport: SoulTransport, covens: string[] = []): Promise<APIResponse> {
    return this.ctx.post('/v1/souls', { data: { sid, transport, covens } });
  }

  assignCoven(sids: string[], coven: string): Promise<APIResponse> {
    return this.ctx.post('/v1/souls/coven', {
      data: { mode: 'append', label: coven, selector: { sids } },
    });
  }

  assignTraits(sids: string[], traits: Record<string, unknown>): Promise<APIResponse> {
    return this.ctx.post('/v1/souls/traits', {
      data: { mode: 'merge', traits, selector: { sids } },
    });
  }

  async listSouls(query: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
    const res = await this.ctx.get('/v1/souls', { params: query });
    const body = await res.json();
    return (body.items ?? []) as Record<string, unknown>[];
  }

  // ── services ───────────────────────────────────────────────────────────────
  async listServices(): Promise<Record<string, unknown>[]> {
    const res = await this.ctx.get('/v1/services');
    const body = await res.json();
    return (body.items ?? []) as Record<string, unknown>[];
  }

  async listScenarios(service: string): Promise<{ status: number; scenarios: Record<string, unknown>[] }> {
    const res = await this.ctx.get(`/v1/services/${encodeURIComponent(service)}/scenarios`);
    const status = res.status();
    if (status !== 200) return { status, scenarios: [] };
    const body = await res.json();
    return { status, scenarios: (body.scenarios ?? []) as Record<string, unknown>[] };
  }

  async serviceAvailable(service: string): Promise<boolean> {
    const { status } = await this.listScenarios(service);
    return status === 200;
  }

  // ── incarnations ─────────────────────────────────────────────────────────────
  async createIncarnation(body: CreateIncarnationBody): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.ctx.post('/v1/incarnations', { data: body });
    return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async getIncarnation(name: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.ctx.get(`/v1/incarnations/${encodeURIComponent(name)}`);
    return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async listIncarnations(query: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
    const res = await this.ctx.get('/v1/incarnations', { params: { limit: '200', ...query } });
    const body = await res.json();
    return (body.items ?? []) as Record<string, unknown>[];
  }

  async listIncarnationRuns(name: string): Promise<Record<string, unknown>[]> {
    const res = await this.ctx.get(`/v1/incarnations/${encodeURIComponent(name)}/runs`);
    if (res.status() !== 200) return [];
    const body = await res.json();
    return (body.items ?? []) as Record<string, unknown>[];
  }

  async getRunDetail(name: string, applyId: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.ctx.get(
      `/v1/incarnations/${encodeURIComponent(name)}/runs/${encodeURIComponent(applyId)}`,
    );
    return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  rerunLast(name: string, reason: string): Promise<APIResponse> {
    return this.ctx.post(`/v1/incarnations/${encodeURIComponent(name)}/rerun-last`, { data: { reason } });
  }

  // Толерантно к 404 (уже снесена) — для afterEach-уборки.
  async destroyIncarnation(name: string): Promise<number> {
    const res = await this.ctx.delete(`/v1/incarnations/${encodeURIComponent(name)}`, {
      params: { allow_destroy: 'true' },
    });
    return res.status();
  }
}
