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
  'common:navSouls', 'common:navSynods', 'common:navVigils', 'common:synodsAria',
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
  'souls:covensLabel', 'souls:soulprintTitle',
  'synods:title',
];

// Technical identifiers, wire field names, DSL fragments, validation patterns
// and bare glyphs — translating them would break what they name.
const TECHNICAL = [
  'admin:svcTabRefs', 'admin:svcMetaGit', 'admin:svcMetaRef', 'admin:svcColGit',
  'admin:svcColRef', 'admin:svcRefsColCommit', 'admin:svcIncColRef', 'admin:svcRefsTitle',
  'admin:pluginErrKebab', 'admin:pluginFieldRef',
  'admin:rbacErrRoleNamePattern',
  'admin:rbacScopeKey_incarnation', 'admin:rbacScopeKey_service', 'admin:rbacScopeKey_coven',
  'admin:rbacScopeKey_host', 'admin:auditExpand', 'admin:auditArchonPrefix', 'admin:helpMcpTitle',
  'admin:auditCorrelationId', 'admin:svcRefreshLabel',
  'beacons:errActionScenarioSnake', 'beacons:celWhereAria',
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
  'run:cadenceKindCron', 'run:sidRegexAria',
  'runhistory:dryRunLabel', 'runhistory:filterSshProviderLabel', 'runhistory:pushDestinyHint',
  'runhistory:pushDestinyRefLabel',
  'runhistory:runFailedPlanIndex', 'runhistory:runFailedTaskIdx', 'runhistory:runKeeperSideBadge',
  'runhistory:runLiveBadge', 'runhistory:countNoMatch', 'runhistory:voyageTargetsColApplyId',
  'runhistory:voyageChangedRunStatusUnknown', 'runhistory:sidLabel',
  'souls:traitRemovePair',
];

// Example values shown inside inputs — samples of real data, not prose.
const PLACEHOLDERS = [
  'admin:svcNamePlaceholder', 'admin:svcIdPlaceholderRedis', 'admin:svcLabelPlaceholderRedis',
  'admin:svcRefPlaceholder',
  'admin:svcRefPlaceholderMain', 'admin:svcRefreshPlaceholder', 'admin:svcGitPlaceholder',
  'admin:pluginNamePlaceholder', 'admin:pluginRegisterCrumbsRefPlaceholder',
  'admin:pluginAliasPlaceholder', 'admin:pluginSourcePlaceholder', 'admin:pluginRefPlaceholder',
  'admin:rbacRoleNamePlaceholder', 'admin:rbacScopeTraitKeyPlaceholder',
  'admin:rbacScopeTraitValuePlaceholder', 'admin:auditTypePlaceholder',
  'admin:auditArchonAidPlaceholder', 'admin:auditCorrelationPlaceholder',
  'admin:loginTokenPlaceholder',
  'beacons:covenPlaceholder', 'beacons:subjectSidPlaceholder',
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

// ---------------------------------------------------------------------------
// Literal English text left in JSX.
//
// The locale checks above compare two JSON files, so a string that never
// reached a locale file is invisible to them. That is exactly how ~180 field
// labels and a11y attributes stayed English in the Russian UI after NIM-213 —
// they were hardcoded in the markup, so there was nothing for a translator to
// translate and nothing for the guard to compare (NIM-259).
//
// The scan is deliberately limited to three patterns. A blanket rule over every
// JSX string literal reports far more noise than signal (class names, format
// fragments, data attributes), and a guard nobody can keep green stops being a
// guard.
//
// A literal survives only by being listed below with the reason it is not
// prose. Everything else has to go through t(). The inventory lives here rather
// than as English-identical i18n keys on purpose: a wire field name is not a
// translation unit, and minting one dead key per payload field would bury the
// strings a translator actually has to work on.
const SCAN_DIRS = ['src/pages', 'src/components'];

// Wire field names rendered as their own label: these detail panels show the
// payload verbatim, key beside value. Translating the key would misname the
// field the value came from.
const WIRE_FIELD_LABELS = [
  'arch', 'attempt', 'available_mb', 'batch_size', 'by', 'changed', 'cleanup_stale',
  'codename', 'collected_at', 'concurrency', 'count', 'coven', 'covens', 'created_at', 'destiny',
  'distro', 'dry_run', 'duration_ms', 'error', 'exit_code', 'expires_at', 'expires_at: ',
  'family', 'finished_at', 'fqdn', 'hostname', 'init_system', 'keys', 'kind', 'label',
  'labels', 'matched', 'mode', 'model', 'module', 'on_failure', 'pkg_mgr', 'primary_ip',
  'received_at', 'recursive', 'release', 'scenario', 'scope_size', 'sid', 'ssh_provider',
  'started_at', 'started_by', 'state_schema_version', 'status', 'swap_mb',
  'target.incarnations', 'target.sids', 'targets', 'total_mb', 'transport', 'vendor',
  'version',
];

// Technical identifiers and enum values used as the accessible name of a
// control that has no prose label of its own.
const TECHNICAL_A11Y_NAMES = [
  'SID', 'batch_mode_barrier', 'batch_mode_window', 'cleanup_stale_versions',
  'correlation_id', 'dry_run', 'enabled-only', 'group-roles', 'provisioning-policy',
  'require_alive', 'schedule_kind_cron', 'schedule_kind_interval',
];

const LITERAL_PROPER_NAMES = ['Soul Stack'];

const ALLOWED_LITERALS = new Map<string, string>([
  ...WIRE_FIELD_LABELS.map((s) => [s, 'wire field name'] as const),
  ...TECHNICAL_A11Y_NAMES.map((s) => [s, 'technical identifier'] as const),
  ...LITERAL_PROPER_NAMES.map((s) => [s, 'proper name'] as const),
]);

// `[^<{]` on the first character is what separates a literal from an already
// interpolated `>{t('…')}<`.
const LITERAL_PATTERNS = [
  /className=\{styles\.metaKey\}>([^<{][^<]*)</g,
  /aria-label="([^"]*)"/g,
  /(?<![-\w])title="([^"]*)"/g,
];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function jsxLiterals(): { where: string; text: string }[] {
  const found: { where: string; text: string }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of tsxFiles(path.resolve(dir))) {
      const rel = path.relative(path.resolve('.'), file);
      readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        for (const re of LITERAL_PATTERNS) {
          for (const m of line.matchAll(re)) found.push({ where: `${rel}:${i + 1}`, text: m[1] });
        }
      });
    }
  }
  return found;
}

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

  // A "…By" label names WHO did something, and the column under it holds an
  // archon AID, not a timestamp. Russian has to carry that "by whom": dropping
  // it turns the label into a past participle that reads as a date, right next
  // to a real "Created" column ("Создан" vs "Создано" — NIM-264).
  //
  // The rule cannot be widened to every English value ending in "by": there,
  // "by" also introduces a criterion ("Split by" → «Разбить по»), which is a
  // different word and correctly translated. Keying off the key name as well
  // keeps it to labels that genuinely name an actor.
  it('“…By” labels keep the actor in Russian', () => {
    const missing: string[] = [];
    for (const ns of namespaces) {
      const en = loadNs(EN_DIR, ns);
      const ru = loadNs(RU_DIR, ns);
      for (const [key, value] of Object.entries(en)) {
        if (!key.endsWith('By') || typeof value !== 'string') continue;
        if (!/\bby$/i.test(value.trim())) continue;
        if (!/кем/i.test(ru[key] ?? '')) missing.push(`${ns}:${key} — en "${value}" vs ru "${ru[key]}"`);
      }
    }
    expect(
      missing,
      'A "…By" label must say by whom in Russian (e.g. «Кем создано»), otherwise ' +
        'it reads as a timestamp and collides with the neighbouring "Created" column.',
    ).toEqual([]);
  });

  it('field labels and a11y attributes are not hardcoded English', () => {
    const literals = jsxLiterals().filter((l) => !ALLOWED_LITERALS.has(l.text));
    expect(
      literals.map((l) => `${l.where} — "${l.text}"`),
      'A field label, aria-label or title written straight into JSX can never ' +
        'reach the Russian locale — there is no key for a translator to fill in. ' +
        "Replace it with t('<ns>:<key>') and add the key to BOTH " +
        'src/i18n/locales/en/<ns>.json and public/locales/ru/<ns>.json. If the ' +
        'string is a wire field name or a technical identifier rather than prose, ' +
        'add it to the matching list in this file instead.',
    ).toEqual([]);
  });

  it('the JSX literal inventory has no stale entries', () => {
    const present = new Set(jsxLiterals().map((l) => l.text));
    const stale = [...ALLOWED_LITERALS.keys()].filter((s) => !present.has(s));
    expect(
      stale,
      'These literals are listed as intentionally-English but no longer appear ' +
        'in the scanned patterns. Drop them from the list.',
    ).toEqual([]);
  });

  // Vocabulary the product rules out: the "fleet" metaphor (we speak of Souls)
  // and borrowed config-management jargon (CLAUDE.md, dictionary invariant).
  //
  // Both are stated as permanent rules, and both still shipped in visible
  // strings — in English as well as Russian, so it was the original wording at
  // fault, not the translation. A rule written only in prose does not hold.
  //
  // "master" is deliberately NOT banned: it names a Redis replication role in
  // placeholder examples ("redis-master", "master / replica"), where it is the
  // real term and not the metaphor.
  const BANNED_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
    [/fleet/i, 'the fleet metaphor — say Souls, or name the hosts'],
    [/флот/i, 'the fleet metaphor — say Souls, or name the hosts'],
    [/\bminions?\b/i, 'borrowed config-management jargon'],
    [/\bgrains?\b/i, 'borrowed config-management jargon'],
    [/\bpillars?\b/i, 'borrowed config-management jargon'],
    [/state\.apply/i, 'borrowed config-management jargon'],
  ];

  it('locale values avoid vocabulary the dictionary rules out', () => {
    const hits: string[] = [];
    for (const [side, dir] of [['en', EN_DIR], ['ru', RU_DIR]] as const) {
      for (const ns of namespaces) {
        for (const [key, value] of Object.entries(loadNs(dir, ns))) {
          if (typeof value !== 'string') continue;
          for (const [pattern, reason] of BANNED_WORDS) {
            if (pattern.test(value)) hits.push(`${side}/${ns}:${key} — ${reason} — "${value}"`);
          }
        }
      }
    }
    expect(hits, 'These strings use vocabulary the product dictionary rules out.').toEqual([]);
  });
});
