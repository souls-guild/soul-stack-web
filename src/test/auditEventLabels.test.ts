/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// Every audit event type the keeper can emit must have a human label, in both
// locales. The audit page composes the key at runtime from server data
// (`auditEventLabelKey`), which is precisely why the locale-file guard cannot
// see this category: comparing en against ru says nothing about whether a key
// the server will ask for exists at all. That blind spot let 124 types go
// unlabelled and 8 labels outlive their event type (NIM-337, NIM-343).
//
// The catalog is vendored next to the OpenAPI spec because OpenAPI declares
// `AuditEvent.type` as a bare string with no enum — until that changes
// (NIM-346) this file is the only list the frontend can check itself against,
// and it has to be refreshed together with the spec.

const CATALOG = path.resolve('vendor/openapi/audit-event-types.txt');
const EN = path.resolve('src/i18n/locales/en/admin.json');
const RU = path.resolve('public/locales/ru/admin.json');

const PREFIX = 'auditEventLabel_';

function eventTypes(): string[] {
  return readFileSync(CATALOG, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function labelKeys(file: string): Set<string> {
  const bundle = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>;
  return new Set(Object.keys(bundle).filter((k) => k.startsWith(PREFIX)));
}

// Mirrors auditEventLabelKey() in src/pages/audit/AuditLog.tsx.
const keyFor = (type: string) => PREFIX + type.replace(/\./g, '_');

describe('audit event labels cover the keeper catalog', () => {
  it('every event type has a label in both locales', () => {
    const en = labelKeys(EN);
    const ru = labelKeys(RU);
    const missing = eventTypes().flatMap((type) => {
      const key = keyFor(type);
      const gaps: string[] = [];
      if (!en.has(key)) gaps.push(`${type} — missing in en`);
      if (!ru.has(key)) gaps.push(`${type} — missing in ru`);
      return gaps;
    });
    expect(
      missing,
      'An event type with no label renders bare in the audit log. Add ' +
        `${PREFIX}<type with dots as underscores> to BOTH ` +
        'src/i18n/locales/en/admin.json and public/locales/ru/admin.json.',
    ).toEqual([]);
  });

  it('no label survives its event type', () => {
    const known = new Set(eventTypes().map(keyFor));
    const orphans = [...labelKeys(EN)].filter((k) => !known.has(k)).sort();
    expect(
      orphans,
      'These labels name event types the keeper no longer emits — the kind of ' +
        'leftover a rename produces (tide.* and errand_run.* outlived the ' +
        'Voyage cutover). Drop them from both locales, or refresh ' +
        'vendor/openapi/audit-event-types.txt if the type is simply newer.',
    ).toEqual([]);
  });
});
