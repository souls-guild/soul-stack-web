// A registry entity is identified by `id` and captioned by `label` (ADR-0085).
// `id` is immutable and feeds derived addresses (Vault paths, RBAC scopes); `label`
// is free text and feeds nothing. These helpers keep the display rule in one place:
// show the caption, fall back to the identifier, never show an empty cell.

export interface CaptionedEntity {
  id: string;
  label?: string;
}

/** What the operator reads: the caption when there is one, else the identifier. */
export function entityCaption(e: CaptionedEntity): string {
  const label = e.label?.trim();
  return label ? label : e.id;
}

/**
 * Whether the identifier still needs showing beside the caption. False when the
 * caption is absent (the caption slot already shows the id) or when it repeats
 * the id verbatim — printing `redis` twice reads as a rendering bug.
 */
export function showsIdBeside(e: CaptionedEntity): boolean {
  const label = e.label?.trim();
  return Boolean(label) && label !== e.id;
}
