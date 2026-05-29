// Target DSL UI → API-форма (ErrandRunTarget / Tide-target).
//
// UI поддерживает 5 режимов выбора:
//   sids        — multi-select SID (FQDN).
//   coven       — список Coven-меток (chips).
//   glob        — `prod-*` (FQDN-маска, шлётся как CEL `sid.glob("…")`).
//   regex       — `^db-[0-9]+$` (POSIX RE2, шлётся как `sid.matches("…")`).
//   cel_where   — raw CEL предикат.
//
// Backend (Errand multi-target и Tide invocation-time override) ожидает форму
// `{ sids?: [...], coven?: [...], where?: "<CEL>" }`. Translator AND-merge-ит
// все включённые режимы через `where`-конъюнкцию.

import type { ErrandRunTarget } from '../../api/keeper';
import i18n from '../../i18n';

// Pure-функции (вне React-дерева) используют глобальный i18n-инстанс.
const t = i18n.t.bind(i18n);

export type TargetMode = 'sids' | 'coven' | 'glob' | 'regex' | 'cel_where';

export interface TargetSpec {
  // Активные режимы (порядок не важен; AND-merge во `where`).
  modes: ReadonlySet<TargetMode>;
  sids: string[];
  coven: string[];
  glob: string;
  regex: string;
  celWhere: string;
}

export const EMPTY_TARGET_SPEC: TargetSpec = {
  modes: new Set<TargetMode>(),
  sids: [],
  coven: [],
  glob: '',
  regex: '',
  celWhere: '',
};

// Escape для подстановки строкового literal-а в CEL: backslash и double-quote.
// Других escape-ов CEL не требует для базового string literal.
function celString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// CEL-AND-merge: если where-предикатов несколько, склеиваем через `&&` с paren-обёрткой.
function andMerge(parts: string[]): string | undefined {
  const nonEmpty = parts.filter((p) => p.trim().length > 0);
  if (nonEmpty.length === 0) return undefined;
  if (nonEmpty.length === 1) return nonEmpty[0];
  return nonEmpty.map((p) => `(${p})`).join(' && ');
}

export interface TranslateResult {
  target: ErrandRunTarget;
  // Не-fatal предупреждения (например, пустой glob, пустой sids-список и т.п.).
  warnings: string[];
}

export function translateTarget(spec: TargetSpec): TranslateResult {
  const warnings: string[] = [];
  const whereParts: string[] = [];
  const target: ErrandRunTarget = {};

  if (spec.modes.has('sids')) {
    if (spec.sids.length === 0) {
      warnings.push(t('run:warnSidsEmpty'));
    } else {
      target.sids = [...spec.sids];
    }
  }

  if (spec.modes.has('coven')) {
    if (spec.coven.length === 0) {
      warnings.push(t('run:warnCovenEmpty'));
    } else {
      target.coven = [...spec.coven];
    }
  }

  if (spec.modes.has('glob')) {
    const g = spec.glob.trim();
    if (!g) warnings.push(t('run:warnGlobEmpty'));
    else whereParts.push(`sid.glob(${celString(g)})`);
  }

  if (spec.modes.has('regex')) {
    const r = spec.regex.trim();
    if (!r) warnings.push(t('run:warnRegexEmpty'));
    else whereParts.push(`sid.matches(${celString(r)})`);
  }

  if (spec.modes.has('cel_where')) {
    const w = spec.celWhere.trim();
    if (!w) warnings.push(t('run:warnCelWhereEmpty'));
    else whereParts.push(w);
  }

  const merged = andMerge(whereParts);
  if (merged !== undefined) target.where = merged;

  return { target, warnings };
}

// Краткая текстовая сводка для preview-counter / submit-кнопки.
export function describeTarget(spec: TargetSpec): string {
  const parts: string[] = [];
  if (spec.modes.has('sids') && spec.sids.length > 0) parts.push(`${spec.sids.length} SID`);
  if (spec.modes.has('coven') && spec.coven.length > 0) parts.push(`coven=[${spec.coven.join(',')}]`);
  if (spec.modes.has('glob') && spec.glob.trim()) parts.push(`glob=${spec.glob.trim()}`);
  if (spec.modes.has('regex') && spec.regex.trim()) parts.push(`regex=${spec.regex.trim()}`);
  if (spec.modes.has('cel_where') && spec.celWhere.trim()) parts.push(`where=${spec.celWhere.trim()}`);
  return parts.length === 0 ? t('run:targetNotSet') : parts.join(' AND ');
}

// Считаем «есть ли реально хоть что-то задающее scope». Используется для блокировки submit.
export function hasAnyTarget(spec: TargetSpec): boolean {
  if (spec.modes.has('sids') && spec.sids.length > 0) return true;
  if (spec.modes.has('coven') && spec.coven.length > 0) return true;
  if (spec.modes.has('glob') && spec.glob.trim()) return true;
  if (spec.modes.has('regex') && spec.regex.trim()) return true;
  if (spec.modes.has('cel_where') && spec.celWhere.trim()) return true;
  return false;
}

// CSV-парсер для target_sids/target_coven: trim + drop empty.
function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Восстановление TargetSpec из URL search-params. Используется bulk-run actions
// со списочных страниц (SoulsList / HostsTab / ServiceDetail) для pre-fill
// Step 3 Wizard-а. Поддерживаемые ключи:
//   target_sids   — CSV SID-ов → mode='sids'.
//   target_coven  — CSV Coven-меток → mode='coven'.
//   target_glob   — FQDN-маска → mode='glob'.
//   target_regex  — RE2 → mode='regex'.
//   target_where  — raw CEL → mode='cel_where'.
// Несколько ключей одновременно — AND-merge (несколько активных режимов).
export function specFromQueryParams(params: URLSearchParams): TargetSpec {
  const modes = new Set<TargetMode>();
  const sidsRaw = params.get('target_sids');
  const covenRaw = params.get('target_coven');
  const globRaw = params.get('target_glob');
  const regexRaw = params.get('target_regex');
  const whereRaw = params.get('target_where');

  const sids = sidsRaw ? splitCsv(sidsRaw) : [];
  const coven = covenRaw ? splitCsv(covenRaw) : [];
  const glob = globRaw ?? '';
  const regex = regexRaw ?? '';
  const celWhere = whereRaw ?? '';

  if (sids.length > 0) modes.add('sids');
  if (coven.length > 0) modes.add('coven');
  if (glob.trim().length > 0) modes.add('glob');
  if (regex.trim().length > 0) modes.add('regex');
  if (celWhere.trim().length > 0) modes.add('cel_where');

  return { modes, sids, coven, glob, regex, celWhere };
}

// Был ли в query вообще задан target-параметр (чтобы wizard понял, что нужно
// прыгать на Step 3 минуя Step 2 при готовых workload-params).
export function queryHasTargetParams(params: URLSearchParams): boolean {
  return (
    params.has('target_sids') ||
    params.has('target_coven') ||
    params.has('target_glob') ||
    params.has('target_regex') ||
    params.has('target_where')
  );
}

// Фильтры со списочной страницы Souls (status/transport/coven) + soulprint-DSL
// → CEL-фрагмент для передачи в Wizard через ?target_where=...
// status=connected         → `status == "connected"`
// transport=agent          → `transport == "agent"`
// coven=[prod,stage]       → `("prod" in covens) || ("stage" in covens)`
// soulprint os.family=debian → `soulprint.self.os.family == "debian"`
// AND-merge всех непустых частей с paren-обёрткой.
export interface SoulsFilterSnapshot {
  status?: string;
  transport?: string;
  covens?: string[];
  // Уже распарсенные правила soulprintFilter. Передаются как есть, без
  // re-парсинга: SoulsList уже умеет валидировать syntax.
  soulprintRules?: ReadonlyArray<{ path: string; op: string; value: string | number }>;
  // SID-search (contains) — переводится в sid.glob или sid.matches; здесь
  // используем подстроку через CEL `sid.contains(...)`. Если пусто — игнорим.
  sidSearch?: string;
}

export function filtersToCEL(snap: SoulsFilterSnapshot): string {
  const parts: string[] = [];
  if (snap.status && snap.status.length > 0) {
    parts.push(`status == ${celString(snap.status)}`);
  }
  if (snap.transport && snap.transport.length > 0) {
    parts.push(`transport == ${celString(snap.transport)}`);
  }
  if (snap.covens && snap.covens.length > 0) {
    const orParts = snap.covens.map((c) => `${celString(c)} in covens`);
    parts.push(orParts.length === 1 ? orParts[0] : orParts.map((p) => `(${p})`).join(' || '));
  }
  if (snap.sidSearch && snap.sidSearch.trim().length > 0) {
    parts.push(`sid.contains(${celString(snap.sidSearch.trim())})`);
  }
  if (snap.soulprintRules && snap.soulprintRules.length > 0) {
    for (const rule of snap.soulprintRules) {
      const cel = soulprintRuleToCEL(rule);
      if (cel) parts.push(cel);
    }
  }
  return andMerge(parts) ?? '';
}

// Перевод одного soulprintFilter-правила в CEL. Wildcard '*' → matches(...).
// Семантика — упрощённое best-effort: CEL backend сам решает, разрешён ли
// он для where-таргетинга; здесь мы только генерируем фрагмент.
function soulprintRuleToCEL(rule: { path: string; op: string; value: string | number }): string | null {
  const path = `soulprint.self.${rule.path}`;
  const v = rule.value;
  if (typeof v === 'number') {
    switch (rule.op) {
      case '=': return `${path} == ${v}`;
      case '!=': return `${path} != ${v}`;
      case '>=': return `${path} >= ${v}`;
      case '<=': return `${path} <= ${v}`;
      default: return null;
    }
  }
  // Строка: wildcard → matches с конверсией '*' → '.*'.
  const isWildcard = v.includes('*');
  if (isWildcard) {
    const re = v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regexLit = celString(`^${re}$`);
    switch (rule.op) {
      case '=':
      case '~': return `${path}.matches(${regexLit})`;
      case '!=': return `!${path}.matches(${regexLit})`;
      default: return null;
    }
  }
  switch (rule.op) {
    case '=': return `${path} == ${celString(v)}`;
    case '!=': return `${path} != ${celString(v)}`;
    case '~': return `${path}.contains(${celString(v)})`;
    default: return null;
  }
}
