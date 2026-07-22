// splitScenarioNote splits a scenario description into a LEAD paragraph (the first) and the rest.
// The lead is rendered as a prominent info-callout ABOVE the run-form fields — the operator
// sees it BEFORE running and can't miss it (NIM-73: for the operational add_user/update_users
// scenario, this is a precondition note about pre-seeding the user password in Vault). The rest
// is dim, below the fields. folded-YAML paragraphs are split by \n (no newlines within a paragraph).
// Source — scenario.description (source of truth); the UI does not hardcode text for
// a specific scenario.
export function splitScenarioNote(description?: string): { lead: string; rest: string } {
  const paras = (description ?? '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { lead: paras[0] ?? '', rest: paras.slice(1).join('\n') };
}
