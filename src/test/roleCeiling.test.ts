import { describe, it, expect } from 'vitest';
import type { RoleView, SynodView } from '../api/keeper';
import {
  callerPermissionGate,
  ceilingExpr,
  derivationChain,
  heldRoleNames,
  parentBounds,
  roleAllowsBase,
  roleCeilingFor,
  roleScopeCeiling,
} from '../pages/rbac/roleCeiling';
import { conjoinScopes } from '../pages/rbac/scopeExpr';

// NIM-182 / ADR-078: the bound a parent role puts on a derived one, read off the
// catalog's RESOLVED form (effective_permissions / effective_scope). These are the
// guards for the direction of the attenuation — every case here would, if inverted,
// let the UI offer a grant the server refuses (or worse, present a widening as legal).

describe('conjoinScopes — pinning a parent scope must not widen it', () => {
  it('parenthesizes an OR side instead of gluing strings', () => {
    // `coven=a OR coven=b` + `trait.x=1` glued reads as `coven=a OR (coven=b AND …)` —
    // a WIDER predicate than intended. Parsing forces the correct grouping.
    expect(conjoinScopes('coven=a OR coven=b', 'trait.x=1')).toBe('(coven=a OR coven=b) AND trait.x=1');
  });

  it('an in-list needs no extra parentheses', () => {
    expect(conjoinScopes('coven in (dba, web)', 'trait.x=1')).toBe('coven in (dba, web) AND trait.x=1');
  });

  it('an empty side returns the other verbatim', () => {
    expect(conjoinScopes('coven=dba', '')).toBe('coven=dba');
    expect(conjoinScopes('', 'coven=dba')).toBe('coven=dba');
  });

  it('throws on an unparseable side rather than guessing', () => {
    expect(() => conjoinScopes('coven ===', 'trait.x=1')).toThrow();
  });
});

function role(over: Partial<RoleView> & { name: string }): RoleView {
  return {
    builtin: false,
    operators: [],
    permissions: [],
    effective_permissions: [],
    ...over,
  } as RoleView;
}

describe('roleAllowsBase — a derived role may only pick a subset (Variant B)', () => {
  it('an exact permission covers itself and nothing wider', () => {
    const parent = role({ name: 'dba', effective_permissions: ['incarnation.read'] });
    expect(roleAllowsBase(parent, 'incarnation.read')).toBe(true);
    // The action wildcard is WIDER than the single action the parent holds.
    expect(roleAllowsBase(parent, 'incarnation.*')).toBe(false);
    expect(roleAllowsBase(parent, 'incarnation.destroy')).toBe(false);
    expect(roleAllowsBase(parent, '*')).toBe(false);
  });

  it('a resource wildcard covers every action of that resource, including itself', () => {
    const parent = role({ name: 'dba', effective_permissions: ['incarnation.*'] });
    expect(roleAllowsBase(parent, 'incarnation.*')).toBe(true);
    expect(roleAllowsBase(parent, 'incarnation.destroy')).toBe(true);
    // ...but never another resource, and never full access.
    expect(roleAllowsBase(parent, 'soul.list')).toBe(false);
    expect(roleAllowsBase(parent, '*')).toBe(false);
  });

  it('full access covers everything', () => {
    const parent = role({ name: 'admin', effective_permissions: ['*'] });
    expect(roleAllowsBase(parent, '*')).toBe(true);
    expect(roleAllowsBase(parent, 'incarnation.destroy')).toBe(true);
  });

  it('a parent that grants nothing admits nothing', () => {
    expect(roleAllowsBase(role({ name: 'empty' }), 'incarnation.read')).toBe(false);
  });

  it('reads effective_permissions, not the stored rows', () => {
    // A derived parent stores `incarnation.*` but resolves to only `incarnation.read`;
    // trusting `permissions` here would offer a grant the enforcer denies.
    const parent = role({
      name: 'dba-ro',
      parent_role: 'dba',
      permissions: ['incarnation.*'],
      effective_permissions: ['incarnation.read'],
    });
    expect(roleAllowsBase(parent, 'incarnation.destroy')).toBe(false);
    expect(roleAllowsBase(parent, 'incarnation.read')).toBe(true);
  });
});

describe('roleCeilingFor — the scope a derived role narrows', () => {
  it('takes the scope of the covering permission', () => {
    const parent = role({
      name: 'dba',
      effective_permissions: ['incarnation.read on coven=dba'],
    });
    expect(roleCeilingFor(parent, 'incarnation.read')).toEqual({
      unrestricted: false,
      exprs: ['coven=dba'],
    });
  });

  it('a bare permission inherits the role scope — NOT unrestricted', () => {
    const parent = role({
      name: 'dba',
      effective_permissions: ['incarnation.read'],
      effective_scope: 'coven=dba',
    });
    expect(roleCeilingFor(parent, 'incarnation.read')).toEqual({
      unrestricted: false,
      exprs: ['coven=dba'],
    });
  });

  it('unscoped permission under an unscoped role is unrestricted', () => {
    const parent = role({ name: 'admin', effective_permissions: ['incarnation.read'] });
    expect(roleCeilingFor(parent, 'incarnation.read')).toEqual({ unrestricted: true, exprs: [] });
  });

  it('the most specific cover wins over a broader one', () => {
    const parent = role({
      name: 'dba',
      effective_permissions: ['* on coven=all', 'incarnation.* on coven=dba', 'incarnation.read on coven=ro'],
    });
    // exact beats resource-wildcard beats `*`
    expect(roleCeilingFor(parent, 'incarnation.read')?.exprs).toEqual(['coven=ro']);
    expect(roleCeilingFor(parent, 'incarnation.destroy')?.exprs).toEqual(['coven=dba']);
    expect(roleCeilingFor(parent, 'soul.list')?.exprs).toEqual(['coven=all']);
  });

  it('several grants at the same specificity are collected (they OR)', () => {
    const parent = role({
      name: 'dba',
      effective_permissions: ['incarnation.read on coven=a', 'incarnation.read on coven=b'],
    });
    expect(roleCeilingFor(parent, 'incarnation.read')?.exprs).toEqual(['coven=a', 'coven=b']);
  });

  it('an uncovered base has no ceiling at all', () => {
    const parent = role({ name: 'dba', effective_permissions: ['incarnation.read'] });
    expect(roleCeilingFor(parent, 'soul.list')).toBeNull();
  });
});

describe('roleScopeCeiling — the role-level bound the delta narrows', () => {
  it('is the resolved effective scope', () => {
    expect(roleScopeCeiling(role({ name: 'dba', effective_scope: 'coven=dba' }))).toEqual({
      unrestricted: false,
      exprs: ['coven=dba'],
    });
  });

  it('empty effective scope means the parent imposes none', () => {
    expect(roleScopeCeiling(role({ name: 'dba' }))).toEqual({ unrestricted: true, exprs: [] });
  });
});

describe('parentBounds', () => {
  it('memoizes per base so the memoized builders keep their identity', () => {
    const bounds = parentBounds(role({ name: 'dba', effective_permissions: ['incarnation.read'] }));
    expect(bounds.ceilingFor('incarnation.read')).toBe(bounds.ceilingFor('incarnation.read'));
    expect(bounds.allows('incarnation.read')).toBe(true);
  });
});

describe('callerPermissionGate — you cannot grant what you do not hold', () => {
  it('is absent when the rights are unknown or unrestricted (stay optimistic)', () => {
    expect(callerPermissionGate(undefined)).toBeNull();
    expect(callerPermissionGate([{ wildcard: true, scope: { unrestricted: true, exprs: [] } }])).toBeNull();
  });

  it('gates on the held base, ignoring scope (the ceiling panel covers scope)', () => {
    const gate = callerPermissionGate([
      { resource: 'incarnation', action: '*', wildcard: false, scope: { unrestricted: false, exprs: ['coven=dba'] } },
      { resource: 'role', action: 'create', wildcard: false, scope: { unrestricted: true, exprs: [] } },
    ])!;
    expect(gate.allows('incarnation.destroy')).toBe(true);
    expect(gate.allows('incarnation.*')).toBe(true);
    expect(gate.allows('role.create')).toBe(true);
    expect(gate.allows('role.delete')).toBe(false);
    expect(gate.allows('soul.list')).toBe(false);
    expect(gate.allows('*')).toBe(false);
  });

  it('a SCOPED wildcard still gates — it is `*`, just bounded', () => {
    const gate = callerPermissionGate([
      { wildcard: true, scope: { unrestricted: false, exprs: ['coven=dba'] } },
    ])!;
    expect(gate.allows('anything.at-all')).toBe(true);
    expect(gate.allows('*')).toBe(true);
  });
});

describe('callerPermissionGate.ceilingFor — the scope the caller holds a right under', () => {
  // A plain role has no parent to supply a scope, so this IS its ceiling: the enforcer
  // refuses an unscoped grant of a right the caller only holds scoped (verified live).
  it('reports the scope of the held permission', () => {
    const gate = callerPermissionGate([
      { resource: 'incarnation', action: '*', wildcard: false, scope: { unrestricted: false, exprs: ['coven=dba'] } },
    ])!;
    expect(gate.ceilingFor('incarnation.get')).toEqual({ unrestricted: false, exprs: ['coven=dba'] });
  });

  it('the most specific hold wins over a broader one', () => {
    const gate = callerPermissionGate([
      { wildcard: true, scope: { unrestricted: false, exprs: ['coven=all'] } },
      { resource: 'incarnation', action: '*', wildcard: false, scope: { unrestricted: false, exprs: ['coven=dba'] } },
      { resource: 'incarnation', action: 'get', wildcard: false, scope: { unrestricted: false, exprs: ['coven=ro'] } },
    ])!;
    expect(gate.ceilingFor('incarnation.get')?.exprs).toEqual(['coven=ro']);
    expect(gate.ceilingFor('incarnation.run')?.exprs).toEqual(['coven=dba']);
    expect(gate.ceilingFor('soul.list')?.exprs).toEqual(['coven=all']);
  });

  it('an unscoped hold imposes no ceiling, and an unheld base has none at all', () => {
    const gate = callerPermissionGate([
      { resource: 'role', action: 'list', wildcard: false, scope: { unrestricted: true, exprs: [] } },
      { resource: 'incarnation', action: 'get', wildcard: false, scope: { unrestricted: false, exprs: ['coven=dba'] } },
    ])!;
    expect(gate.ceilingFor('role.list')).toEqual({ unrestricted: true, exprs: [] });
    expect(gate.ceilingFor('soul.list')).toBeNull();
  });
});

describe('ceilingExpr', () => {
  it('is empty when the ceiling restricts nothing', () => {
    expect(ceilingExpr(null)).toBe('');
    expect(ceilingExpr({ unrestricted: true, exprs: [] })).toBe('');
  });

  it('parenthesizes a disjunction so AND-ing onto it cannot widen it', () => {
    expect(ceilingExpr({ unrestricted: false, exprs: ['coven=a'] })).toBe('coven=a');
    expect(ceilingExpr({ unrestricted: false, exprs: ['coven=a', 'coven=b'] })).toBe('(coven=a) OR (coven=b)');
  });
});

describe('heldRoleNames', () => {
  const roles = [role({ name: 'dba', operators: ['alice'] }), role({ name: 'admin', operators: ['bob'] })];

  it('takes direct membership', () => {
    expect([...heldRoleNames(roles, [], 'alice')]).toEqual(['dba']);
  });

  it('adds roles bundled by a Synod the caller belongs to', () => {
    const synods = [{ name: 's', builtin: false, operators: ['alice'], roles: ['admin'] }] as SynodView[];
    expect([...heldRoleNames(roles, synods, 'alice')].sort()).toEqual(['admin', 'dba']);
    // A Synod the caller is not in grants nothing.
    expect([...heldRoleNames(roles, synods, 'bob')]).toEqual(['admin']);
  });

  it('an unknown AID holds nothing', () => {
    expect(heldRoleNames(roles, [], undefined).size).toBe(0);
  });
});

describe('derivationChain', () => {
  it('renders root first', () => {
    const roles = [
      role({ name: 'dba' }),
      role({ name: 'dba-prod', parent_role: 'dba' }),
      role({ name: 'dba-prod-ro', parent_role: 'dba-prod' }),
    ];
    expect(derivationChain(roles, 'dba-prod-ro')).toEqual(['dba', 'dba-prod', 'dba-prod-ro']);
    expect(derivationChain(roles, 'dba')).toEqual(['dba']);
  });

  it('stops on a cycle instead of looping forever', () => {
    const roles = [role({ name: 'a', parent_role: 'b' }), role({ name: 'b', parent_role: 'a' })];
    expect(derivationChain(roles, 'a')).toEqual(['b', 'a']);
  });

  it('stops at a parent missing from the catalog', () => {
    expect(derivationChain([role({ name: 'child', parent_role: 'gone' })], 'child')).toEqual([
      'gone',
      'child',
    ]);
  });
});
