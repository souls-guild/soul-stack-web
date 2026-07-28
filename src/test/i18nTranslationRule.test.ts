/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// Guard for the i18n translation rule (CLAUDE.md, principle 6).
//
// The rule: reader-facing text is translated per locale. A key may stay
// English-identical in `ru` ONLY when the English word IS the term — a
// dictionary entity name, a technical identifier, an example value in a
// placeholder, a status enum value, or a proper name.
//
// Structural labels (nav / section headers / page titles / tab names / table
// column headers) are NOT an exemption: they are translated like everything
// else. That reversal is why this guard exists — before it, "structural label"
// was an open-ended excuse and the Russian UI drifted back to half-English.
//
// Adding a key that is identical in both locales fails this test until it is
// either translated or listed below with the reason it stays English.

const EN_DIR = path.resolve('src/i18n/locales/en');
const RU_DIR = path.resolve('public/locales/ru');

// Dictionary entity names — the product's own nouns, English in every locale.
const ENTITY_NAMES = [
  'admin:svcListTitle', 'admin:svcDetailCrumbParent', 'admin:svcTabIncarnations',
  'admin:svcIncColCovens', 'admin:svcSectionTitle', 'admin:svcDepsDestinySection',
  'cadences:title',
  'common:navArchons', 'common:navCadences', 'common:navDecrees', 'common:navGroupOracle',
  'common:navIncarnations', 'common:navPlugins', 'common:navRbac', 'common:navServices',
  'common:navSouls', 'common:navSynods', 'common:navVigils',
  'common:colArchons', 'common:colCoven', 'common:colCovens', 'common:colDestiny',
  'common:colIncarnation', 'common:colIncarnationModule',
  'console:scopeIncarnations', 'console:scopeCovens', 'console:scopeSoulprint',
  'incarnations:tabChoirs', 'incarnations:voices', 'incarnations:colCovens',
  'incarnations:colTraits', 'incarnations:pageTitle',
  'notifications:heraldTitle', 'notifications:tidingTitle', 'notifications:heraldLinkLabel',
  'pages:overviewCovensCount', 'pages:overviewIncarnations',
  'run:stepIncarnations',
  'runhistory:filterServiceLabel', 'runhistory:runColPassage',
  'runhistory:segErrand', 'runhistory:segPush', 'runhistory:segVoyage',
  'souls:covensLabel',
  'synods:title',
];

// Technical identifiers, wire field names, DSL fragments, validation patterns
// and bare glyphs — translating them would break what they name.
const TECHNICAL = [
  'admin:svcTabRefs', 'admin:svcMetaGit', 'admin:svcMetaRef', 'admin:svcColGit',
  'admin:svcColRef', 'admin:svcRefsColCommit', 'admin:svcIncColRef', 'admin:svcRefsTitle',
  'admin:pluginNamespaceHint', 'admin:pluginErrKebab', 'admin:pluginFieldRef',
  'admin:rbacErrRoleNamePattern',
  'admin:rbacScopeKey_incarnation', 'admin:rbacScopeKey_service', 'admin:rbacScopeKey_coven',
  'admin:rbacScopeKey_host', 'admin:auditExpand', 'admin:auditArchonPrefix', 'admin:helpMcpTitle',
  'beacons:errCovenKebab', 'beacons:errActionScenarioSnake',
  'common:pushApply',
  'common:colAid', 'common:colApplyId', 'common:colErrandId', 'common:colId',
  'common:colIpv4', 'common:colIpv6', 'common:colKid', 'common:colMac', 'common:colMtu',
  'common:colOnBeacon', 'common:colRef', 'common:colSha256', 'common:colSid',
  'common:colWhereCel',
  'console:exitCode',
  'incarnations:hostsCardLoading', 'incarnations:kebabPattern', 'incarnations:traitsMoreCount',
  'incarnations:utilCpu', 'incarnations:utilInodes', 'incarnations:utilLoadShort',
  'incarnations:utilSwap',
  'notifications:heraldColUrl', 'notifications:heraldFieldUrl', 'notifications:noFilters',
  'pages:overviewTransportHint', 'pages:overviewSelfHealthTitle',
  'run:sidRegexLabel', 'run:covenKebabError', 'run:destinyRefLabel', 'run:sshProviderLabel',
  'run:covenKebabShortError', 'run:regexLabel', 'run:celWhereLabel', 'run:wherePrefix',
  'run:scheduleAtUtc', 'run:dryRunLabel', 'run:listRemoveItem', 'run:mapRemovePair',
  'run:cadenceKindCron',
  'runhistory:dryRunLabel', 'runhistory:filterSshProviderLabel', 'runhistory:pushDestinyHint',
  'runhistory:runFailedPlanIndex', 'runhistory:runFailedTaskIdx', 'runhistory:runKeeperSideBadge',
  'runhistory:runLiveBadge', 'runhistory:countNoMatch', 'runhistory:voyageTargetsColApplyId',
  'runhistory:voyageChangedRunStatusUnknown', 'runhistory:sidLabel',
  'souls:traitRemovePair',
];

// Example values shown inside inputs — samples of real data, not prose.
const PLACEHOLDERS = [
  'admin:svcNamePlaceholder', 'admin:svcNamePlaceholderRedis', 'admin:svcRefPlaceholder',
  'admin:svcRefPlaceholderMain', 'admin:svcRefreshPlaceholder', 'admin:svcGitPlaceholder',
  'admin:pluginNamePlaceholder', 'admin:pluginRegisterCrumbsRefPlaceholder',
  'admin:pluginNamespacePlaceholder', 'admin:pluginNamePlaceholderAcme', 'admin:pluginRefPlaceholder',
  'admin:rbacRoleNamePlaceholder', 'admin:rbacScopeTraitKeyPlaceholder',
  'admin:rbacScopeTraitValuePlaceholder', 'admin:auditTypePlaceholder',
  'admin:auditArchonAidPlaceholder', 'admin:auditCorrelationPlaceholder',
  'admin:loginTokenPlaceholder',
  'beacons:covenPlaceholder',
  'console:scopeIncarnationsPlaceholder', 'console:scopeCovensPlaceholder',
  'console:scopeSidRegexPlaceholder', 'console:scopeSoulprintPlaceholder',
  'console:groupQueryPlaceholder',
  'incarnations:choirNamePlaceholder', 'incarnations:rolePlaceholder',
  'incarnations:scenarioPlaceholder',
  'notifications:tidingFieldProjectionPlaceholder',
  'pages:archonDisplayNamePlaceholder',
  'run:incarnationRegexPlaceholder', 'run:hostIncarnationsPlaceholder', 'run:sidRegexPlaceholder',
  'run:soulprintPlaceholder', 'run:newIncarnationNamePlaceholder', 'run:covensPlaceholder',
  'run:moduleNamePlaceholder', 'run:destinyRefPlaceholder', 'run:sshProviderNamePlaceholder',
  'run:covenLabelsPlaceholder', 'run:globPlaceholder', 'run:regexPlaceholder',
  'run:celWherePlaceholder', 'run:cadenceNamePlaceholder', 'run:notifyProjectionPlaceholder',
  'souls:searchSidPlaceholder', 'souls:soulprintSearchPlaceholder', 'souls:covensPlaceholder',
  'souls:createSidPlaceholder',
  'synods:namePlaceholder',
];

// Status / enum values as the API emits them.
const STATUS_VALUES = [
  'admin:rbacParentTagBuiltin', 'admin:rbacAssignBuiltinSuffix',
  'synods:builtin',
];

// Proper names (font families).
const PROPER_NAMES = [
  'admin:fontManrope', 'admin:fontQuicksand', 'admin:fontUnbounded',
  'admin:fontCaveat', 'admin:fontComfortaa', 'admin:fontComicNeue',
];

const ALLOWED_ENGLISH = new Map<string, string>([
  ...ENTITY_NAMES.map((k) => [k, 'entity name'] as const),
  ...TECHNICAL.map((k) => [k, 'technical identifier'] as const),
  ...PLACEHOLDERS.map((k) => [k, 'placeholder example'] as const),
  ...STATUS_VALUES.map((k) => [k, 'status value'] as const),
  ...PROPER_NAMES.map((k) => [k, 'proper name'] as const),
]);

function loadNs(dir: string, ns: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(dir, `${ns}.json`), 'utf-8'));
}

const namespaces = readdirSync(EN_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

function identicalKeys(): string[] {
  const out: string[] = [];
  for (const ns of namespaces) {
    const en = loadNs(EN_DIR, ns);
    const ru = loadNs(RU_DIR, ns);
    for (const k of Object.keys(en)) {
      if (en[k] === ru[k]) out.push(`${ns}:${k}`);
    }
  }
  return out;
}

describe('i18n translation rule', () => {
  it('every English-identical ru value is explicitly allowed', () => {
    const unexplained = identicalKeys().filter((k) => !ALLOWED_ENGLISH.has(k));
    expect(
      unexplained,
      'These keys read the same in Russian as in English. Translate them in ' +
        'public/locales/ru/<ns>.json, or — if the English word IS the term ' +
        '(entity name / technical identifier / placeholder / status value / proper ' +
        'name) — add them to the matching list in this file. "It is a structural ' +
        'label" is NOT a reason: nav items, section headers, page titles, tab names ' +
        'and table column headers are translated.',
    ).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const identical = new Set(identicalKeys());
    const stale = [...ALLOWED_ENGLISH.keys()].filter((k) => !identical.has(k));
    expect(
      stale,
      'These keys are allow-listed as English-identical but no longer are ' +
        '(translated, renamed or deleted). Drop them from the list.',
    ).toEqual([]);
  });

  it('interpolation placeholders match between en and ru', () => {
    const holders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const mismatched: string[] = [];
    for (const ns of namespaces) {
      const en = loadNs(EN_DIR, ns);
      const ru = loadNs(RU_DIR, ns);
      for (const k of Object.keys(en)) {
        if (typeof en[k] !== 'string' || typeof ru[k] !== 'string') continue;
        const a = holders(en[k]).join(','), b = holders(ru[k]).join(',');
        if (a !== b) mismatched.push(`${ns}:${k} — en [${a}] vs ru [${b}]`);
      }
    }
    expect(mismatched, 'A dropped or renamed {{placeholder}} renders as literal text.').toEqual([]);
  });

  // Both locales are kept in the same sorted key order so the two files diff
  // side by side. Without this they drift the moment two changes insert a key
  // by different rules, and the next locale edit carries a whole-file reshuffle
  // as collateral.
  it('both locales are sorted and in identical key order', () => {
    const unsorted: string[] = [];
    const misordered: string[] = [];
    for (const ns of namespaces) {
      const en = Object.keys(loadNs(EN_DIR, ns));
      const ru = Object.keys(loadNs(RU_DIR, ns));
      for (const [side, keys] of [['en', en], ['ru', ru]] as const) {
        if (JSON.stringify(keys) !== JSON.stringify([...keys].sort())) unsorted.push(`${side}/${ns}`);
      }
      if (JSON.stringify(en) !== JSON.stringify(ru)) misordered.push(ns);
    }
    expect(unsorted, 'Locale files must have their keys sorted alphabetically.').toEqual([]);
    expect(misordered, 'en and ru must list keys in the same order.').toEqual([]);
  });
});
