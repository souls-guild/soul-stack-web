// Парсер и evaluator client-side фильтра по фактам Soulprint (ADR-018).
//
// DSL — намеренно простой и непохожий на CEL: оператор ищет «os.family=debian»,
// а не пишет полноценный предикат. Если позже окажется, что нужен server-side
// filter — фронтенд переключим, синтаксис у пользователя останется тот же.
//
// Грамматика правила:
//   <path><op><value>
// где
//   path  := dotted-путь по SoulprintFacts (os.family, kernel.version, memory.total_mb, …).
//   op    := = | != | >= | <= | ~          (~  — wildcard / содержит)
//   value := строка или число (auto-detect: parseFloat если строка целиком число).
// Несколько правил соединяются ' & ' или whitespace — AND.
// Wildcard в строковых значениях: `*` → любая подстрока. `6.*` ≡ startsWith('6.').
//
// evalRule неизвестные пути → false (правило не матчится), без throw — UX тихо
// исключает хост, а не валится с ошибкой.

export type FilterOp = '=' | '!=' | '>=' | '<=' | '~';

export interface FilterRule {
  path: string;
  op: FilterOp;
  value: string | number;
}

export interface ParseResult {
  rules: FilterRule[];
  invalid: string[];
}

// Порядок важен: '!=' / '>=' / '<=' проверяем ДО '='.
const OPS: FilterOp[] = ['!=', '>=', '<=', '~', '='];

export function parseSoulprintFilter(input: string): ParseResult {
  const rules: FilterRule[] = [];
  const invalid: string[] = [];
  const tokens = input
    .split(/[&\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const tok of tokens) {
    const rule = parseRule(tok);
    if (rule) rules.push(rule);
    else invalid.push(tok);
  }
  return { rules, invalid };
}

function parseRule(token: string): FilterRule | null {
  for (const op of OPS) {
    const idx = token.indexOf(op);
    if (idx <= 0) continue;
    const path = token.slice(0, idx).trim();
    const raw = token.slice(idx + op.length).trim();
    if (!path || !raw) return null;
    // Числовой compare имеет смысл только для числовых значений.
    if (op === '>=' || op === '<=') {
      const num = Number(raw);
      if (Number.isNaN(num)) return null;
      return { path, op, value: num };
    }
    // = / != / ~ : auto-detect число vs строка. Wildcard '*' — всегда строка.
    if (!raw.includes('*') && raw !== '' && !Number.isNaN(Number(raw))) {
      return { path, op, value: Number(raw) };
    }
    return { path, op, value: raw };
  }
  return null;
}

// Достаёт значение по dotted-пути, undefined если ветка отсутствует.
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// Wildcard-маска `6.*` / `10.0.*` → строка-«содержит» по сегментам.
function matchWildcard(actual: string, mask: string): boolean {
  if (!mask.includes('*')) return actual === mask;
  // Экранируем regex-метасимволы, кроме '*'.
  const escaped = mask.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(actual);
}

export function evalRule(soulprint: unknown, rule: FilterRule): boolean {
  const actual = getByPath(soulprint, rule.path);
  if (actual === undefined || actual === null) return false;

  switch (rule.op) {
    case '=': {
      if (typeof rule.value === 'number') {
        return typeof actual === 'number' && actual === rule.value;
      }
      // Wildcard или exact, оба через matchWildcard.
      return matchWildcard(String(actual), rule.value);
    }
    case '!=': {
      if (typeof rule.value === 'number') {
        return typeof actual === 'number' && actual !== rule.value;
      }
      return !matchWildcard(String(actual), rule.value);
    }
    case '~': {
      // Substring / wildcard. Если в маске нет '*' — substring.
      const v = String(rule.value);
      const a = String(actual);
      if (v.includes('*')) return matchWildcard(a, v);
      return a.toLowerCase().includes(v.toLowerCase());
    }
    case '>=': {
      const num = typeof actual === 'number' ? actual : Number(actual);
      if (Number.isNaN(num)) return false;
      return num >= (rule.value as number);
    }
    case '<=': {
      const num = typeof actual === 'number' ? actual : Number(actual);
      if (Number.isNaN(num)) return false;
      return num <= (rule.value as number);
    }
  }
}

export function applyFilter(soulprint: unknown, rules: FilterRule[]): boolean {
  if (rules.length === 0) return true;
  for (const r of rules) {
    if (!evalRule(soulprint, r)) return false;
  }
  return true;
}
