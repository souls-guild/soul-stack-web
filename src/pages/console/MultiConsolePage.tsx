// Multi-console — the third Run mode: live PTY shells on a selection of VMs.
//
// Flow: build a scope (incarnation / coven / SID pattern / soulprint) -> Connect
// -> N consoles. The scope screen comes back whenever the selection has to
// change, and re-connecting reconciles the wall instead of rebuilding it.
//
// Groups are tabs. Splitting by any dimension the scope itself uses is an
// operator convenience — nothing about it reaches the wire — but it is what
// makes a heterogeneous incarnation (control VMs vs data VMs) safe to work on:
// each tab has its own input, so a line typed for one group cannot land on
// another.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PlugZap, Search, SlidersHorizontal, StretchVertical, Type } from 'lucide-react';
import { keeperApi, type SoulListEntry } from '../../api/keeper';
import { createWebSocketTransport, type ConsoleTransportHooks } from '../../api/consoleSocket';
import { createMockTransport } from '../../api/consoleMockTransport';
import { Button } from '../../components/primitives';
import { EMPTY_HOST_CRITERIA, type HostCriteria } from '../run/hostSelector';
import { ConsoleSessionStore, type ConsoleStoreSnapshot } from './consoleSessionStore';
import { criteriaFromQuery, describeCriteria } from './consoleSelection';
import { useHostResolution } from './useHostResolution';
import { ALL_TAB, buildGroups, sidsForTab, type GroupDef } from './consoleGrouping';
import { searchConsoles } from './consoleSearch';
import {
  COLUMN_CHOICES,
  FONT_SIZES,
  ROW_HEIGHTS,
  loadGroups,
  loadViewPrefs,
  saveGroups,
  saveViewPrefs,
  type ConsoleViewPrefs,
} from './consolePrefs';
import { newGroupId } from './consoleGrouping';
import { ScopePicker } from './ScopePicker';
import { GroupTabs } from './GroupTabs';
import { GroupsEditor } from './GroupsEditor';
import { SelectionToolbar } from './SelectionToolbar';
import { BroadcastBar } from './BroadcastBar';
import { ConsolePane } from './ConsolePane';
import pageStyles from '../common.module.css';
import styles from './MultiConsole.module.css';

const EMPTY_SNAPSHOT: ConsoleStoreSnapshot = { socket: 'connecting', socketError: null, sessions: [] };
const EMPTY_LABELS: readonly string[] = [];
const EMPTY_EXCLUDED: ReadonlySet<string> = new Set();

// Row-height labels: the numbers are pixels, which mean nothing to the operator.
const HEIGHT_LABELS = ['S', 'M', 'L', 'XL'] as const;

// While a query is active the match counter has to follow live output, which
// deliberately bypasses React state — so it is sampled instead.
const SEARCH_SAMPLE_MS = 400;

export function MultiConsolePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // Browser-simulated shells; opt-in only, never a fallback (see consoleMockTransport).
  const useMock = searchParams.get('transport') === 'mock';

  // A link may pre-fill the scope, but never connects on its own: opening root
  // shells is an explicit act, not a side effect of following a URL.
  const [criteria, setCriteria] = useState<HostCriteria>(
    () => criteriaFromQuery(searchParams) ?? EMPTY_HOST_CRITERIA,
  );
  const [scopeOpen, setScopeOpen] = useState(true);
  // The scope the live session was actually opened with — the bar shows this,
  // not the draft being edited.
  const [activeCriteria, setActiveCriteria] = useState<HostCriteria | null>(null);

  const resolution = useHostResolution(criteria);

  const factory = useCallback(
    (hooks: ConsoleTransportHooks) => (useMock ? createMockTransport(hooks) : createWebSocketTransport(hooks)),
    [useMock],
  );

  // Built in an effect, not useMemo: constructing it opens a socket, which must
  // not happen during render.
  const [store, setStore] = useState<ConsoleSessionStore | null>(null);
  useEffect(() => {
    const s = new ConsoleSessionStore(factory);
    setStore(s);
    return () => s.dispose();
  }, [factory]);

  const subscribe = useCallback((cb: () => void) => (store ? store.subscribe(cb) : () => {}), [store]);
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? EMPTY_SNAPSHOT, [store]);
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  const attached = useMemo(() => snap.sessions.map((s) => s.sid), [snap.sessions]);
  const openCount = snap.sessions.filter((s) => s.status === 'open').length;
  const connectingCount = snap.sessions.filter((s) => s.status === 'connecting').length;

  const onConnect = useCallback(() => {
    if (!store) return;
    store.setSelection(resolution.sids);
    setActiveCriteria(criteria);
    setScopeOpen(false);
  }, [store, resolution.sids, criteria]);

  // --- grouping ---

  // Operator-authored group definitions, restored from the last visit — they
  // are hand-written work, not a transient view state.
  const [groupDefs, setGroupDefs] = useState<GroupDef[]>(() => loadGroups(newGroupId));
  useEffect(() => saveGroups(groupDefs), [groupDefs]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);

  // Consoles the operator un-armed, PER TAB. A host unticked while working on
  // one group must stay armed in the others: the tabs are separate working
  // contexts, and a checkbox that reached across them would silently change the
  // blast radius of a tab you are not looking at.
  //
  // Stored as exclusions, not inclusions, so a VM that joins the wall later is
  // armed by default rather than silently sitting out.
  const [excludedByTab, setExcludedByTab] = useState<Record<string, ReadonlySet<string>>>({});

  // Choir is only meaningful inside a single incarnation (ADR-044).
  const choirIncarnation =
    activeCriteria?.incarnations.length === 1 ? activeCriteria.incarnations[0] : '';
  const choirsQ = useQuery({
    queryKey: ['choirs', choirIncarnation],
    enabled: choirIncarnation !== '',
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const list = await keeperApi.choirs.list(choirIncarnation);
      const choirs = list.items ?? [];
      const pairs = await Promise.all(
        choirs.map(async (c) => {
          const v = await keeperApi.choirs.listVoices(choirIncarnation, c.choir_name);
          return { name: c.choir_name, sids: (v.items ?? []).map((x) => x.sid) };
        }),
      );
      return pairs;
    },
  });

  const choirsBySid = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { name, sids } of choirsQ.data ?? []) {
      for (const sid of sids) {
        const list = map.get(sid);
        if (list) list.push(name);
        else map.set(sid, [name]);
      }
    }
    return map;
  }, [choirsQ.data]);

  const connectedSouls = useMemo<SoulListEntry[]>(() => {
    const live = new Set(attached);
    return resolution.allSouls.filter((s) => live.has(s.sid));
  }, [resolution.allSouls, attached]);

  const { groups, labelsBySid, unmatched } = useMemo(
    () => buildGroups(attached, connectedSouls, groupDefs, choirsBySid, t('console:ungrouped')),
    [attached, connectedSouls, groupDefs, choirsBySid, t],
  );

  // A deleted group takes the operator back to All rather than leaving the tab
  // strip pointing at something that no longer exists.
  useEffect(() => {
    if (activeTab === ALL_TAB) return;
    if (!groups.some((g) => g.id === activeTab)) setActiveTab(ALL_TAB);
  }, [groups, activeTab]);

  const tabSids = useMemo(() => sidsForTab(activeTab, groups, attached), [activeTab, groups, attached]);
  const tabSidSet = useMemo(() => new Set(tabSids), [tabSids]);
  // Arming state of the tab currently on screen.
  const excluded = excludedByTab[activeTab] ?? EMPTY_EXCLUDED;

  // What a send from this tab would actually reach: in the tab, armed, open.
  const targetSids = useMemo(() => tabSids.filter((sid) => !excluded.has(sid)), [tabSids, excluded]);
  const targetSidSet = useMemo(() => new Set(targetSids), [targetSids]);
  const tabSelectedCount = targetSids.length;
  const tabLiveCount = snap.sessions.filter((s) => s.status === 'open' && targetSidSet.has(s.sid)).length;

  // All arming edits are keyed by the active tab, so they cannot reach into a
  // tab the operator is not looking at.
  const editTabExclusions = useCallback(
    (edit: (next: Set<string>) => void) => {
      setExcludedByTab((prev) => {
        const next = new Set(prev[activeTab] ?? EMPTY_EXCLUDED);
        edit(next);
        return { ...prev, [activeTab]: next };
      });
    },
    [activeTab],
  );

  const toggleSelected = useCallback(
    (sid: string) => editTabExclusions((next) => (next.has(sid) ? next.delete(sid) : next.add(sid))),
    [editTabExclusions],
  );

  const selectAllInTab = useCallback(
    () => editTabExclusions((next) => tabSids.forEach((sid) => next.delete(sid))),
    [editTabExclusions, tabSids],
  );

  const selectNoneInTab = useCallback(
    () => editTabExclusions((next) => tabSids.forEach((sid) => next.add(sid))),
    [editTabExclusions, tabSids],
  );
  const tabLabel =
    activeTab === ALL_TAB ? t('console:tabAll') : (groups.find((g) => g.id === activeTab)?.name ?? activeTab);

  // --- per-tab command drafts ---

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastSent, setLastSent] = useState<Record<string, number>>({});
  const draft = drafts[activeTab] ?? '';

  const setDraft = useCallback(
    (next: string) => setDrafts((d) => ({ ...d, [activeTab]: next })),
    [activeTab],
  );

  const onSend = useCallback(() => {
    if (!store) return 0;
    const line = drafts[activeTab] ?? '';
    if (line.trim() === '') return 0;
    // Always scoped to the visible tab's ARMED SIDs, including the All tab —
    // the store must never be handed an unscoped broadcast from here.
    const sent = store.broadcast(line, targetSids);
    setDrafts((d) => ({ ...d, [activeTab]: '' }));
    setLastSent((s) => ({ ...s, [activeTab]: sent }));
    return sent;
  }, [store, drafts, activeTab, targetSids]);

  // --- search ---

  const [query, setQuery] = useState('');
  const [onlyMatches, setOnlyMatches] = useState(false);
  // Wall density: columns, terminal font size, row height. Persisted — these are
  // chosen to make a particular fleet's output readable, and re-picking them on
  // every visit is friction for no reason.
  const [view, setView] = useState<ConsoleViewPrefs>(loadViewPrefs);
  useEffect(() => saveViewPrefs(view), [view]);
  const [focused, setFocused] = useState<string | null>(null);

  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => {
    if (query.trim() === '') return;
    const id = setInterval(() => setSearchTick((n) => n + 1), SEARCH_SAMPLE_MS);
    return () => clearInterval(id);
  }, [query]);

  const search = useMemo(
    () =>
      searchConsoles(
        snap.sessions.map((s) => ({ sid: s.sid, text: store?.textOf(s.sid) ?? '' })),
        query,
      ),
    // searchTick re-runs this while a query is active — output bypasses React
    // state, so there is nothing else to invalidate on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap.sessions, query, store, searchTick],
  );

  const onToggleFocus = useCallback((sid: string) => setFocused((cur) => (cur === sid ? null : sid)), []);

  useEffect(() => {
    if (!focused) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFocused(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focused]);

  const queryActive = query.trim() !== '';
  const connected = attached.length > 0;

  return (
    <div className={`${pageStyles.page} ${connected && !scopeOpen ? styles.consolePage : ''}`}>
      <div>
        <div className={pageStyles.crumbs}>
          <Link to="/run">{t('common:navRun')}</Link> / {t('console:pageTitleMultiConsole')}
        </div>
        <h1 className={pageStyles.title}>{t('console:pageTitleMultiConsole')}</h1>
        <p className={styles.subtitle}>{t('console:subtitle')}</p>
      </div>

      {useMock ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`} data-testid="console-mock-banner">
          <AlertTriangle size={15} />
          {t('console:mockBanner')}
        </div>
      ) : null}

      {snap.socket === 'closed' && connected ? (
        <div className={`${styles.banner} ${styles.bannerDanger}`} data-testid="console-disconnected-banner">
          <PlugZap size={15} />
          <span>
            {t('console:connectionLost')}
            {snap.socketError ? ` — ${snap.socketError}` : ''} · {t('console:reconnectHint')}
          </span>
          <Button type="button" variant="secondary" onClick={() => store?.reconnect()} data-testid="console-reconnect">
            {t('console:reconnect')}
          </Button>
        </div>
      ) : null}

      {scopeOpen ? (
        <ScopePicker
          value={criteria}
          onChange={setCriteria}
          matched={resolution.matched}
          loading={resolution.loading}
          soulsUnavailable={resolution.soulsUnavailable}
          soulsTruncated={resolution.soulsTruncated}
          soulsScanned={resolution.soulsScanned}
          soulsTotal={resolution.soulsTotal}
          soulprintOverload={resolution.soulprintOverload}
          soulprintCandidates={resolution.soulprintCandidates}
          invalidSoulprint={resolution.invalidSoulprint}
          regexError={resolution.regexError}
          hasCriteria={resolution.hasCriteria}
          unresolvedIncarnations={resolution.unresolvedIncarnations}
          onConnect={onConnect}
          onCancel={connected ? () => setScopeOpen(false) : null}
          connectedCount={attached.length}
        />
      ) : null}

      {connected && !scopeOpen ? (
        <>
          <div className={styles.scopeBar}>
            <span className={styles.selectionLabel}>{t('console:selectionLabel')}</span>
            {(activeCriteria ? describeCriteria(activeCriteria) : []).map((chip) => (
              <span key={chip} className={`${styles.chip} ${styles.chipMono}`}>
                {chip}
              </span>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setScopeOpen(true)}
              data-testid="console-change-scope"
            >
              <SlidersHorizontal size={14} />
              {t('console:changeSelection')}
            </Button>
            <div className={styles.selectionStats}>
              <span data-testid="console-count-open">
                <b>{openCount}</b> {t('console:attached')}
              </span>
              {connectingCount > 0 ? (
                <span data-testid="console-count-connecting">
                  <b>{connectingCount}</b> {t('console:connecting')}
                </span>
              ) : null}
            </div>
          </div>

          <GroupTabs
            groups={groups}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            totalCount={attached.length}
            onEditGroups={() => setGroupsOpen(true)}
          />

          {groupsOpen ? (
            <GroupsEditor
              defs={groupDefs}
              onChange={setGroupDefs}
              groups={groups}
              unmatchedCount={unmatched.length}
              souls={connectedSouls}
              choirsBySid={choirsBySid}
              onClose={() => setGroupsOpen(false)}
            />
          ) : null}

          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('console:searchPlaceholder')}
                aria-label={t('console:searchPlaceholder')}
                data-testid="console-search"
              />
            </div>
            {queryActive ? (
              <span className={styles.foundLabel} data-testid="console-search-found">
                {t('console:foundIn', { matched: search.matched.size, total: search.total })}
              </span>
            ) : null}
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={onlyMatches}
                onChange={(e) => setOnlyMatches(e.target.checked)}
                data-testid="console-only-matches"
              />
              {t('console:onlyMatches')}
            </label>
            <span className={styles.spacer} />

            <div className={styles.densityGroup}>
              <Type size={13} className={styles.densityIcon} />
              <div className={styles.columnsSeg} role="group" aria-label={t('console:fontSizeLabel')}>
                {FONT_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={view.fontSize === size ? styles.columnsBtnActive : styles.columnsBtn}
                    onClick={() => setView((v) => ({ ...v, fontSize: size }))}
                    aria-pressed={view.fontSize === size}
                    title={t('console:fontSizeTitle', { size })}
                    data-testid={`console-font-${size}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.densityGroup}>
              <StretchVertical size={13} className={styles.densityIcon} />
              <div className={styles.columnsSeg} role="group" aria-label={t('console:rowHeightLabel')}>
                {ROW_HEIGHTS.map((h, i) => (
                  <button
                    key={h}
                    type="button"
                    className={view.rowHeight === h ? styles.columnsBtnActive : styles.columnsBtn}
                    onClick={() => setView((v) => ({ ...v, rowHeight: h }))}
                    aria-pressed={view.rowHeight === h}
                    title={t('console:rowHeightTitle', { height: h })}
                    data-testid={`console-height-${h}`}
                  >
                    {HEIGHT_LABELS[i]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.columnsSeg} role="group" aria-label={t('console:columnsLabel')}>
              {COLUMN_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={view.columns === c ? styles.columnsBtnActive : styles.columnsBtn}
                  onClick={() => setView((v) => ({ ...v, columns: c }))}
                  aria-pressed={view.columns === c}
                  data-testid={`console-cols-${c}`}
                >
                  {c}×
                </button>
              ))}
            </div>
          </div>

          <SelectionToolbar
            total={tabSids.length}
            selected={tabSelectedCount}
            onSelectAll={selectAllInTab}
            onSelectNone={selectNoneInTab}
          />

          <div
            className={`${styles.wall} ${styles[`cols${view.columns}`]}`}
            style={{ '--console-row-h': `${view.rowHeight}px` } as CSSProperties}
            data-testid="console-wall"
          >
            {snap.sessions.map((s) => (
              <ConsolePane
                key={s.sessionId}
                session={s}
                store={store!}
                focused={focused === s.sid}
                selected={!excluded.has(s.sid)}
                onToggleSelected={toggleSelected}
                labels={labelsBySid.get(s.sid) ?? EMPTY_LABELS}
                // Panes outside the active tab stay MOUNTED and hidden: unmounting
                // would dispose the terminal and lose the session's scrollback.
                hidden={!tabSidSet.has(s.sid) || (onlyMatches && queryActive && !search.matched.has(s.sid))}
                fontSize={view.fontSize}
                searchQuery={query}
                onToggleFocus={onToggleFocus}
              />
            ))}
          </div>

          {focused ? <div className={styles.backdrop} onClick={() => setFocused(null)} aria-hidden="true" /> : null}

          <BroadcastBar
            tabLabel={tabLabel}
            value={draft}
            onChange={setDraft}
            onSend={onSend}
            liveCount={tabLiveCount}
            tabCount={tabSids.length}
            lastSent={lastSent[activeTab] ?? null}
          />
        </>
      ) : null}
    </div>
  );
}
