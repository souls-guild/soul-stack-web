// Derived roles (parent_role): what a chosen parent role permits, read straight off
// the catalog's RESOLVED form. `GET /v1/roles` returns every role both AS STORED
// (permissions / default_scope) and AS RESOLVED against its derivation chain
// (effective_permissions / effective_scope) — the resolution is the server's job and
// the UI must never re-derive inheritance from parent_role, or it becomes a second
// implementation of the attenuation rules, free to disagree with the enforcer.
//
// So this module only MATCHES a base permission against an already-resolved set, to
// gate the picker and to show the ceiling. The write path is still refused server-side
// (403 "a derived role may not exceed its parent role").

import type { MyPermission, RoleView, SynodView } from '../../api/keeper';
import { parsePermission } from './permissions';
import { conjoinScopes } from './scopeExpr';

/** Scope ceiling in the shape `useMyPermissions.ceilingFor` returns, so both feed one panel. */
export interface ScopeCeiling {
  unrestricted: boolean;
  exprs: string[];
}

// How specifically `parentBase` covers `base`: 0 = not covered, higher = more
// specific. `resource.*` covers any action of that resource but a single action
// never covers the wildcard — that direction would widen the grant.
function coverage(parentBase: string, base: string): number {
  if (parentBase === base) return 3;
  if (parentBase === '*') return 1;
  if (parentBase.endsWith('.*')) {
    const resource = parentBase.slice(0, -2);
    const dot = base.indexOf('.');
    if (dot > 0 && base.slice(0, dot) === resource) return 2;
  }
  return 0;
}

/**
 * True when the parent's resolved permission set admits `base` — the picker offers a
 * SUBSET of the parent, never anything beyond it. A base outside the set is refused
 * by the server, so the control is disabled rather than silently failing on submit.
 */
export function roleAllowsBase(parent: RoleView, base: string): boolean {
  return (parent.effective_permissions ?? []).some(
    (perm) => coverage(parsePermission(perm).base, base) > 0,
  );
}

/**
 * The parent's scope ceiling for `base`: the scopes of its most specific covering
 * permissions. A bare permission inherits the role's effective_scope (as on a plain
 * role), so an unscoped grant under a scoped role is NOT unrestricted. Returns null
 * when the parent doesn't cover `base` at all → callers hide the panel.
 */
export function roleCeilingFor(parent: RoleView, base: string): ScopeCeiling | null {
  const roleScope = parent.effective_scope?.trim() ?? '';
  let best = 0;
  const exprs: string[] = [];
  let unrestricted = false;

  for (const perm of parent.effective_permissions ?? []) {
    const { base: permBase, scope } = parsePermission(perm);
    const cov = coverage(permBase, base);
    if (cov === 0 || cov < best) continue;
    if (cov > best) {
      best = cov;
      exprs.length = 0;
      unrestricted = false;
    }
    const effective = scope?.trim() || roleScope;
    if (!effective) unrestricted = true;
    else if (!exprs.includes(effective)) exprs.push(effective);
  }

  if (best === 0) return null;
  return unrestricted ? { unrestricted: true, exprs: [] } : { unrestricted: false, exprs };
}

/**
 * The role-level ceiling a derived role's own delta narrows: the parent's resolved
 * default scope. Empty effective_scope means the parent restricts nothing by scope.
 */
export function roleScopeCeiling(parent: RoleView): ScopeCeiling {
  const scope = parent.effective_scope?.trim() ?? '';
  return scope ? { unrestricted: false, exprs: [scope] } : { unrestricted: true, exprs: [] };
}

/**
 * A ceiling as one scope expression ('' = it restricts nothing). Several grants at the
 * same specificity OR together, and each is parenthesized so the disjunction cannot be
 * re-read as a wider predicate once something is AND-ed onto it.
 */
export function ceilingExpr(ceiling: ScopeCeiling | null | undefined): string {
  if (!ceiling || ceiling.unrestricted || ceiling.exprs.length === 0) return '';
  return ceiling.exprs.length === 1 ? ceiling.exprs[0] : `(${ceiling.exprs.join(') OR (')})`;
}

/**
 * What a chosen parent role bounds, as one object passed down the editor tree.
 * `ceilingFor` memoizes per base so the memoized ScopeBuilders keep bailing out on
 * unrelated keystrokes (a fresh ceiling object every render would defeat them).
 */
export interface ParentBounds {
  role: RoleView;
  allows: (base: string) => boolean;
  ceilingFor: (base: string) => ScopeCeiling | null;
  scopeCeiling: ScopeCeiling;
}

export function parentBounds(role: RoleView): ParentBounds {
  const cache = new Map<string, ScopeCeiling | null>();
  return {
    role,
    allows: (base) => roleAllowsBase(role, base),
    ceilingFor: (base) => {
      if (!cache.has(base)) cache.set(base, roleCeilingFor(role, base));
      return cache.get(base) ?? null;
    },
    scopeCeiling: roleScopeCeiling(role),
  };
}

/** What the caller's own rights bound, in the same shape a parent role bounds things. */
export interface CallerBounds {
  allows: (base: string) => boolean;
  ceilingFor: (base: string) => ScopeCeiling | null;
}

/**
 * Gate from the caller's OWN rights (GET /v1/me/permissions): the server caps every grant
 * to a subset of what the caller holds, so offering the rest of the catalog only invites a
 * 403 on submit. `allows` gates the base; `ceilingFor` gives the scope the caller holds it
 * under — holding `incarnation.get on coven=dba` lets you grant `incarnation.get` only at
 * `coven=dba` or narrower, and an UNSCOPED grant of it is refused (verified against the
 * enforcer), which is why a plain role needs this ceiling as much as a derived one needs
 * its parent's.
 *
 * Returns null when there is nothing to gate on: rights unknown (loading / fetch failed
 * → stay optimistic, as hasPermission does) or the caller holds a bare unrestricted `*`.
 */
export function callerPermissionGate(
  perms: readonly MyPermission[] | undefined,
): CallerBounds | null {
  if (!perms) return null;
  const unrestrictedWildcard = perms.some(
    (p) => p.wildcard && (!p.scope || p.scope.unrestricted),
  );
  if (unrestrictedWildcard) return null;

  const held = perms.map((p) => ({
    base: p.wildcard ? '*' : `${p.resource ?? ''}.${p.action ?? ''}`,
    scope: p.scope,
  }));
  const allowCache = new Map<string, boolean>();
  const ceilingCache = new Map<string, ScopeCeiling | null>();
  return {
    allows: (base) => {
      let hit = allowCache.get(base);
      if (hit === undefined) {
        hit = held.some((h) => coverage(h.base, base) > 0);
        allowCache.set(base, hit);
      }
      return hit;
    },
    // Most specific cover wins, exactly as roleCeilingFor does for a parent role, so
    // `incarnation.get on coven=dba` caps the action even when a broader `*` is also held.
    ceilingFor: (base) => {
      if (ceilingCache.has(base)) return ceilingCache.get(base) ?? null;
      let best = 0;
      const exprs: string[] = [];
      let unrestricted = false;
      for (const h of held) {
        const cov = coverage(h.base, base);
        if (cov === 0 || cov < best) continue;
        if (cov > best) {
          best = cov;
          exprs.length = 0;
          unrestricted = false;
        }
        if (!h.scope || h.scope.unrestricted) unrestricted = true;
        else for (const e of h.scope.exprs ?? []) if (!exprs.includes(e)) exprs.push(e);
      }
      const result =
        best === 0
          ? null
          : unrestricted
            ? { unrestricted: true, exprs: [] }
            : { unrestricted: false, exprs };
      ceilingCache.set(base, result);
      return result;
    },
  };
}

/**
 * The scope a PLAIN role must carry so it stays inside the caller's own rights: every
 * distinct restricted ceiling among the picked permissions, conjoined (each has to hold).
 * '' when the caller is unrestricted, nothing is picked, or every pick is held unscoped.
 *
 * Only for a role with no parent — a derived one gets its bound from the parent, which
 * the server conjoins on resolve.
 */
export function callerScopeFloor(
  caller: CallerBounds | null | undefined,
  permissions: readonly string[] | undefined,
): string {
  if (!caller) return '';
  const floors: string[] = [];
  for (const perm of permissions ?? []) {
    const expr = ceilingExpr(caller.ceilingFor(parsePermission(perm).base));
    if (expr && !floors.includes(expr)) floors.push(expr);
  }
  try {
    return floors.reduce((acc, e) => (acc ? conjoinScopes(acc, e) : e), '');
  } catch {
    // An expression this client can't re-serialize: show the strictest single one rather
    // than string-gluing, which could silently widen the predicate.
    return floors[0] ?? '';
  }
}

/**
 * Role names the caller demonstrably holds: direct membership plus every role bundled by
 * a Synod they belong to. Membership only — the rights themselves stay the server's call.
 */
export function heldRoleNames(
  roles: readonly RoleView[],
  synods: readonly SynodView[] | undefined,
  aid: string | undefined,
): Set<string> {
  const held = new Set<string>();
  if (!aid) return held;
  for (const r of roles) {
    if ((r.operators ?? []).includes(aid)) held.add(r.name);
  }
  for (const s of synods ?? []) {
    if (!(s.operators ?? []).includes(aid)) continue;
    for (const r of s.roles ?? []) held.add(r);
  }
  return held;
}

/**
 * The derivation chain of `name`, root first (`grandparent → parent → name`), read by
 * following parent_role through the catalog. Display only — the effective rights come
 * resolved from the server. Stops on an unknown link or a cycle (the server caps depth
 * and refuses cycles; this guard keeps a stale catalog from hanging the render).
 */
export function derivationChain(roles: readonly RoleView[], name: string): string[] {
  const byName = new Map(roles.map((r) => [r.name, r]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = name;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.unshift(cur);
    cur = byName.get(cur)?.parent_role || undefined;
  }
  return chain;
}
