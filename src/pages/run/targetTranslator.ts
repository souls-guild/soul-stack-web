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
      warnings.push('режим SIDs включён, но список SID пуст');
    } else {
      target.sids = [...spec.sids];
    }
  }

  if (spec.modes.has('coven')) {
    if (spec.coven.length === 0) {
      warnings.push('режим Coven включён, но список меток пуст');
    } else {
      target.coven = [...spec.coven];
    }
  }

  if (spec.modes.has('glob')) {
    const g = spec.glob.trim();
    if (!g) warnings.push('режим Glob включён, но маска пустая');
    else whereParts.push(`sid.glob(${celString(g)})`);
  }

  if (spec.modes.has('regex')) {
    const r = spec.regex.trim();
    if (!r) warnings.push('режим Regex включён, но выражение пустое');
    else whereParts.push(`sid.matches(${celString(r)})`);
  }

  if (spec.modes.has('cel_where')) {
    const w = spec.celWhere.trim();
    if (!w) warnings.push('режим CEL where включён, но предикат пустой');
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
  return parts.length === 0 ? '— target не задан —' : parts.join(' AND ');
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
