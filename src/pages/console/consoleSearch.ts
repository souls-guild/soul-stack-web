// Cross-pane search over the plain-text mirrors kept by the session store.
//
// xterm's SearchAddon highlights inside ONE terminal; the wall additionally
// needs "which consoles contain this" for the counter and the only-matches
// filter. Both work off the same mirror, so highlight and filter never disagree.

export interface ConsoleSearchResult {
  // sids whose output contains the query (empty query -> empty set).
  matched: Set<string>;
  // Consoles searched, i.e. how many panes the counter is out of.
  total: number;
}

export function searchConsoles(
  entries: ReadonlyArray<{ sid: string; text: string }>,
  query: string,
): ConsoleSearchResult {
  const q = query.trim().toLowerCase();
  const matched = new Set<string>();
  if (q === '') return { matched, total: entries.length };
  for (const e of entries) {
    if (e.text.toLowerCase().includes(q)) matched.add(e.sid);
  }
  return { matched, total: entries.length };
}
