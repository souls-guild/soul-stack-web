import { request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = resolve(HERE, '.auth');
const TOKEN_FILE = resolve(AUTH_DIR, 'token.txt');
const STATE_FILE = resolve(AUTH_DIR, 'state.json');

const KEEPER = process.env.SMOKE_KEEPER_API ?? 'http://127.0.0.1:8080';
const WEB_ORIGIN = 'http://localhost:5173';
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const STAND_HINT =
  'подними стенд: (cd ../soul-stack && make dev-provision && make dev-keeper && make dev-web)';

function coreDir(): string {
  return process.env.SOUL_STACK_CORE_DIR ?? resolve(HERE, '..', '..', 'soul-stack');
}

// SMOKE_JWT → make dev-jwt (VAULT_TOKEN=root: в env оператора обычно prod-token) →
// файл $KEEPER_DEV_DIR/archon-dev.jwt. Первый рабочий источник выигрывает.
function mintJwt(): string {
  const fromEnv = process.env.SMOKE_JWT?.trim();
  if (fromEnv && JWT_RE.test(fromEnv)) return fromEnv;

  try {
    const out = execFileSync('make', ['-s', '-C', coreDir(), 'dev-jwt'], {
      encoding: 'utf8',
      timeout: 60_000,
      // Форсируем dev-Vault token: в env оператора VAULT_TOKEN обычно prod (сломает read).
      env: { ...process.env, VAULT_TOKEN: process.env.SMOKE_VAULT_TOKEN || 'root' },
    });
    const line = out
      .split('\n')
      .map((l) => l.trim())
      .reverse()
      .find((l) => JWT_RE.test(l));
    if (line) return line;
  } catch {
    // fallback ниже
  }

  const devDir = process.env.KEEPER_DEV_DIR ?? '/tmp/keeper-dev';
  const file = resolve(devDir, 'archon-dev.jwt');
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (JWT_RE.test(t)) return t;
  }
  throw new Error(
    `не удалось получить JWT: задай SMOKE_JWT, либо ${STAND_HINT} (для make dev-jwt нужен Vault + VAULT_TOKEN=root)`,
  );
}

async function globalSetup(): Promise<void> {
  const ctx = await request.newContext();
  let status = 0;
  try {
    const res = await ctx.get(`${KEEPER}/healthz`);
    status = res.status();
  } catch (err) {
    await ctx.dispose();
    throw new Error(`Keeper недоступен на ${KEEPER}/healthz (${String(err)}). ${STAND_HINT}`);
  }
  await ctx.dispose();
  if (status !== 200) throw new Error(`Keeper ${KEEPER}/healthz вернул ${status}, ожидалось 200. ${STAND_HINT}`);

  const token = mintJwt();

  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token, 'utf8');
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        cookies: [],
        origins: [{ origin: WEB_ORIGIN, localStorage: [{ name: 'soul-stack.jwt', value: token }] }],
      },
      null,
      2,
    ),
    'utf8',
  );
}

export default globalSetup;
