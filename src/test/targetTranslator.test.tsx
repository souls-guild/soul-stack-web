import { describe, it, expect } from 'vitest';
import {
  EMPTY_TARGET_SPEC,
  describeTarget,
  hasAnyTarget,
  translateTarget,
  type TargetMode,
  type TargetSpec,
} from '../pages/run/targetTranslator';

function makeSpec(modes: TargetMode[], overrides: Partial<TargetSpec> = {}): TargetSpec {
  return {
    ...EMPTY_TARGET_SPEC,
    modes: new Set(modes),
    sids: overrides.sids ?? [],
    coven: overrides.coven ?? [],
    glob: overrides.glob ?? '',
    regex: overrides.regex ?? '',
    celWhere: overrides.celWhere ?? '',
  };
}

describe('targetTranslator', () => {
  it('пустой spec → пустой target, нет warnings', () => {
    const tr = translateTarget(EMPTY_TARGET_SPEC);
    expect(tr.target).toEqual({});
    expect(tr.warnings).toEqual([]);
    expect(hasAnyTarget(EMPTY_TARGET_SPEC)).toBe(false);
  });

  it('режим SIDs кладёт sids[] в target', () => {
    const spec = makeSpec(['sids'], { sids: ['host01', 'host02'] });
    const tr = translateTarget(spec);
    expect(tr.target.sids).toEqual(['host01', 'host02']);
    expect(tr.target.where).toBeUndefined();
    expect(tr.warnings).toEqual([]);
  });

  it('режим Coven кладёт coven[] в target', () => {
    const spec = makeSpec(['coven'], { coven: ['prod', 'eu-west'] });
    const tr = translateTarget(spec);
    expect(tr.target.coven).toEqual(['prod', 'eu-west']);
    expect(tr.target.where).toBeUndefined();
  });

  it('Glob → sid.glob("…") в where', () => {
    const spec = makeSpec(['glob'], { glob: 'prod-*' });
    const tr = translateTarget(spec);
    expect(tr.target.where).toBe('sid.glob("prod-*")');
  });

  it('Regex → sid.matches("…") в where', () => {
    const spec = makeSpec(['regex'], { regex: '^db-[0-9]+$' });
    const tr = translateTarget(spec);
    expect(tr.target.where).toBe('sid.matches("^db-[0-9]+$")');
  });

  it('CEL where — raw, без обёртки', () => {
    const spec = makeSpec(['cel_where'], {
      celWhere: 'soulprint.self.os.family == "debian"',
    });
    const tr = translateTarget(spec);
    expect(tr.target.where).toBe('soulprint.self.os.family == "debian"');
  });

  it('два where-режима — AND-merge с paren-обёрткой', () => {
    const spec = makeSpec(['glob', 'regex'], { glob: 'prod-*', regex: '^db-[0-9]+$' });
    const tr = translateTarget(spec);
    expect(tr.target.where).toBe('(sid.glob("prod-*")) && (sid.matches("^db-[0-9]+$"))');
  });

  it('coven + glob — coven живёт в target.coven, glob — в where', () => {
    const spec = makeSpec(['coven', 'glob'], { coven: ['prod'], glob: 'app-*' });
    const tr = translateTarget(spec);
    expect(tr.target.coven).toEqual(['prod']);
    expect(tr.target.where).toBe('sid.glob("app-*")');
  });

  it('escape строкового literal в CEL: double-quote и backslash', () => {
    const spec = makeSpec(['glob'], { glob: 'host"with\\quote' });
    const tr = translateTarget(spec);
    expect(tr.target.where).toBe('sid.glob("host\\"with\\\\quote")');
  });

  it('включённый режим с пустым значением → warning', () => {
    const spec = makeSpec(['glob', 'coven'], { glob: '', coven: [] });
    const tr = translateTarget(spec);
    expect(tr.target.where).toBeUndefined();
    expect(tr.warnings.length).toBe(2);
  });

  it('describeTarget — читаемое summary', () => {
    const spec = makeSpec(['sids', 'glob'], { sids: ['h1', 'h2'], glob: 'prod-*' });
    expect(describeTarget(spec)).toBe('2 SID AND glob=prod-*');
  });

  it('hasAnyTarget — false если режим включён но пустой', () => {
    const spec = makeSpec(['glob'], { glob: '   ' });
    expect(hasAnyTarget(spec)).toBe(false);
  });
});
