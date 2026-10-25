// normalizeLoginAID — Keeper's operator.NormalizeLoginAID,
// strings.ToLower(strings.TrimSpace(aid)), in the browser: a password login
// compares the AID its Bearer names with the typed one. JavaScript's trim()
// and toLowerCase() differ from Go's here: Go trims U+0085 and not U+FEFF, and
// its simple case mapping takes U+0130 to "i" where toLowerCase() gives "i"
// followed by U+0307.
const GO_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const EDGES = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, 'g');

export function normalizeLoginAID(aid: string): string {
  return aid.replace(EDGES, '').replace(/\u0130/g, 'i').toLowerCase();
}
