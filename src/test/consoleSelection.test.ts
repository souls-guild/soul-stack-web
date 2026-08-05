/**
 * NIM-146: what a link may pre-fill on the console scope form.
 *
 * A link never connects on its own, so the risk here is not "opens shells" but
 * "opens the wrong ones": a criterion the browser cannot apply must be dropped
 * loudly (not carried), and an explicit SID list must not turn into a pattern
 * that matches more than it names.
 */
import { describe, it, expect } from 'vitest';
import { criteriaFromQuery, describeCriteria, globToRegexSource } from '../pages/console/consoleSelection';
import { consoleHrefFrom } from '../pages/console/consoleLink';
import { EMPTY_HOST_CRITERIA, compileSidRegex } from '../pages/run/hostSelector';

function fromQuery(qs: string) {
  return criteriaFromQuery(new URLSearchParams(qs));
}

describe('criteriaFromQuery', () => {
  it('returns null when the link says nothing about scope', () => {
    expect(fromQuery('')).toBeNull();
    expect(fromQuery('transport=mock')).toBeNull();
  });

  it('maps incarnation and coven', () => {
    expect(fromQuery('incarnation=mongoshard')).toMatchObject({ incarnations: ['mongoshard'] });
    expect(fromQuery('target_coven=payments,stage')).toMatchObject({ covens: ['payments', 'stage'] });
  });

  it('maps a regex and a soulprint straight through', () => {
    expect(fromQuery('target_regex=mongo-sh-.*')).toMatchObject({ sidRegex: 'mongo-sh-.*' });
    expect(fromQuery('target_soulprint=os.family%3Ddebian')).toMatchObject({
      soulprint: 'os.family=debian',
    });
  });

  it('[INVARIANT] an explicit SID list becomes a pattern matching exactly those SIDs', () => {
    const c = fromQuery('target_sids=mongo-sh-01,mongo-sh-02');
    const { re } = compileSidRegex(c!.sidRegex);
    expect(re!.test('mongo-sh-01')).toBe(true);
    expect(re!.test('mongo-sh-02')).toBe(true);
    // Neither a superstring nor a sibling may slip in.
    expect(re!.test('mongo-sh-011')).toBe(false);
    expect(re!.test('mongo-sh-03')).toBe(false);
  });

  it('escapes regex metacharacters in an explicit SID', () => {
    const c = fromQuery('target_sids=' + encodeURIComponent('host.a+b'));
    const { re } = compileSidRegex(c!.sidRegex);
    expect(re!.test('host.a+b')).toBe(true);
    expect(re!.test('hostXaab')).toBe(false);
  });

  it('maps a glob, treating only * as a wildcard', () => {
    const c = fromQuery('target_glob=' + encodeURIComponent('pay-*.svc'));
    const { re } = compileSidRegex(c!.sidRegex);
    expect(re!.test('pay-01.svc')).toBe(true);
    expect(re!.test('pay-01Xsvc')).toBe(false);
  });

  it('[INVARIANT] raw CEL is NOT carried into the scope', () => {
    // The browser cannot evaluate it; silently dropping it while keeping the
    // rest would open shells on a wider set than the link asked for.
    const c = fromQuery('target_coven=payments&target_where=' + encodeURIComponent('soulprint.self.os.family=="debian"'));
    expect(c).toMatchObject({ covens: ['payments'] });
    expect(JSON.stringify(c)).not.toContain('debian');
  });
});

describe('globToRegexSource', () => {
  it('treats only * as a wildcard', () => {
    expect(globToRegexSource('a.b*c')).toBe('a\\.b.*c');
  });
});

describe('describeCriteria', () => {
  it('renders the live scope as chips', () => {
    expect(
      describeCriteria({
        ...EMPTY_HOST_CRITERIA,
        incarnations: ['mongoshard'],
        covens: ['payments'],
        sidRegex: 'mongo-.*',
        soulprint: 'os.family=debian',
      }),
    ).toEqual(['incarnation=mongoshard', 'coven=payments', 'sid~mongo-.*', 'os.family=debian']);
  });

  it('omits empty criteria', () => {
    expect(describeCriteria({ ...EMPTY_HOST_CRITERIA, covens: ['web'] })).toEqual(['coven=web']);
  });
});

describe('consoleHrefFrom', () => {
  it('lands under /run and carries only scope params', () => {
    expect(consoleHrefFrom(new URLSearchParams('workload=console&module=core.cmd.shell&target_coven=payments'))).toBe(
      '/run/console?target_coven=payments',
    );
  });

  it('drops raw CEL, which the scope form cannot express', () => {
    const href = consoleHrefFrom(new URLSearchParams('target_where=' + encodeURIComponent('sid.glob("a*")')));
    expect(href).toBe('/run/console');
  });

  it('is a bare link when nothing scopes it', () => {
    expect(consoleHrefFrom(new URLSearchParams('workload=console'))).toBe('/run/console');
  });
});
