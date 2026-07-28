// Pure model helpers for the boolean scope condition-builder (NIM-128): fresh-node
// constructors and pruning of in-progress empty rows before serialization. Kept
// out of ScopeBuilder.tsx so the component file exports only components.

import { parseScope, serializeScope, type ScopeCond, type ScopeDim, type ScopeGroup, type ScopeNode } from './scopeExpr';

export function newCond(dim: ScopeDim): ScopeCond {
  if (dim === 'trait') return { kind: 'cond', dim: 'trait', key: '', match: 'in', values: [''] };
  return { kind: 'cond', dim, match: 'in', values: [] };
}

export function newGroup(op: 'and' | 'or'): ScopeGroup {
  return { kind: 'group', op, children: [newCond('coven')] };
}

function condEmpty(c: ScopeCond): boolean {
  if (c.dim === 'trait') return !c.key?.trim() || !(c.values[0] ?? '').trim();
  return c.values.filter((v) => v.trim() !== '').length === 0;
}

/**
 * Drop in-progress empty conditions/groups so the wire string stays clean. Returns
 * the cleaned node, or null when nothing meaningful remains. A single-child group
 * collapses to its child (serializeScope does the same).
 */
export function pruneScope(node: ScopeNode | null | undefined): ScopeNode | null {
  if (!node) return null;
  if (node.kind === 'cond') {
    if (condEmpty(node)) return null;
    if (node.dim === 'trait') return { ...node, values: [(node.values[0] ?? '').trim()] };
    return { ...node, values: node.values.map((v) => v.trim()).filter(Boolean) };
  }
  const kids = node.children
    .map(pruneScope)
    .filter((n): n is ScopeNode => n !== null);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  return { ...node, children: kids };
}

// --- editor slot: a parsed tree, or the raw string when it doesn't parse ---

/**
 * One scope under edit: a boolean tree for the builder or, when an existing scope
 * string doesn't parse, a raw-string fallback the operator can still edit verbatim
 * (graceful degradation — NIM-128).
 */
export type ScopeSlot = { kind: 'tree'; node: ScopeNode | null } | { kind: 'raw'; text: string };

/** The canonical wire string of a slot ('' = no scope). */
export function slotScopeString(slot: ScopeSlot | undefined): string {
  if (!slot) return '';
  if (slot.kind === 'raw') return slot.text.trim();
  return serializeScope(pruneScope(slot.node));
}

/** Reads an existing scope string into a slot; unparseable → a raw slot. */
export function slotFromScope(scope: string | undefined): ScopeSlot | undefined {
  if (!scope) return undefined;
  try {
    return { kind: 'tree', node: parseScope(scope) };
  } catch {
    return { kind: 'raw', text: scope };
  }
}
