import { test as base, expect } from '@playwright/test';
import { SmokeApi } from './api';

let counter = 0;
// Уникальное имя: Date.now доступен в спеках. Счётчик разводит вызовы в одном ms.
export function uniqueName(prefix: string): string {
  counter += 1;
  return `smoke-${prefix}-${Date.now()}-${counter}`;
}

export async function pollIncarnationStatus(
  api: SmokeApi,
  name: string,
  want: (status: string) => boolean,
  { tries = 20, intervalMs = 500 } = {},
): Promise<string> {
  let last = '';
  for (let i = 0; i < tries; i += 1) {
    const { status, body } = await api.getIncarnation(name);
    last = status === 200 ? String(body.status ?? '') : `http-${status}`;
    if (want(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

type Fixtures = {
  api: SmokeApi;
  // Регистрация созданных инкарнаций для destroy в teardown (толерантно к 404).
  track: (name: string) => void;
};

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = await SmokeApi.create();
    await use(api);
    await api.dispose();
  },
  track: async ({ api }, use) => {
    const names: string[] = [];
    await use((name: string) => names.push(name));
    for (const name of names) {
      await api.destroyIncarnation(name).catch(() => undefined);
    }
  },
});

export { expect };
