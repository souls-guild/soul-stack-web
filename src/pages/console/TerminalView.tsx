// xterm.js view for a single console session.
//
// The only module that touches xterm — everything above it speaks bytes and
// (cols, rows). Keeping it isolated also keeps the wall testable: jsdom cannot
// measure glyphs, so tests stub this component out.

import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import styles from './MultiConsole.module.css';

interface Props {
  // Live output for this pane. Subscribing replays the buffered scrollback.
  subscribeOutput: (cb: (bytes: Uint8Array) => void) => () => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  // Highlighted inside this terminal; '' clears the decorations.
  searchQuery: string;
  // Closed/errored sessions stay readable but stop accepting keystrokes.
  interactive: boolean;
  // Terminal font size in px. Smaller fits more columns of output per pane.
  fontSize: number;
  label: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Only the surface colours are themed. The 16 ANSI slots stay at xterm's
// defaults on purpose: they are chosen by the remote program, and re-mapping
// them would misrepresent what the host actually printed.
function readTheme(): ITheme {
  return {
    background: cssVar('--term-bg', '#0d0f0e'),
    foreground: cssVar('--term-fg', '#d6d3d1'),
    cursor: cssVar('--term-cursor', '#34d399'),
    selectionBackground: cssVar('--term-selection', 'rgba(20, 184, 166, 0.35)'),
  };
}

export function TerminalView({ subscribeOutput, onInput, onResize, searchQuery, interactive, fontSize, label }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Read at mount only; changes are applied by the effect below, which also
  // refits. Putting it in the mount deps would rebuild the terminal and wipe
  // the live PTY view.
  const initialFontSize = useRef(fontSize);
  // Read through refs so re-created callbacks never force a terminal rebuild
  // (a rebuild would wipe the live PTY view).
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  inputRef.current = onInput;
  resizeRef.current = onResize;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: cssVar('--font-mono', 'JetBrains Mono, monospace'),
      fontSize: initialFontSize.current,
      scrollback: 5000,
      theme: readTheme(),
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(host);
    termRef.current = term;
    searchRef.current = search;
    fitRef.current = fit;

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        // Pane not laid out yet (hidden by the only-matches filter) — the next
        // observer tick refits.
      }
    };

    const offData = term.onData((data) => inputRef.current(data));
    // Registered BEFORE the first fit: fit() only emits onResize when the
    // dimensions actually change, so subscribing afterwards would miss the
    // initial measurement and leave the PTY at the default 80x24 forever.
    const offResize = term.onResize(({ cols, rows }) => resizeRef.current(cols, rows));
    safeFit();

    const offOutput = subscribeOutput((bytes) => term.write(bytes));

    const ro = new ResizeObserver(safeFit);
    ro.observe(host);

    // Theme switch flips CSS variables on <html>; re-read them.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      ro.disconnect();
      themeObserver.disconnect();
      offOutput();
      offData.dispose();
      offResize.dispose();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
      fitRef.current = null;
    };
  }, [subscribeOutput]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.disableStdin = !interactive;
  }, [interactive]);

  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;

    // A new font size means new cell dimensions, so the old cols/rows no longer
    // describe the pane. Refit — that emits onResize and the PTY follows, which
    // is the whole point: smaller glyphs give the remote program more columns.
    //
    // Deferred to the next frame ON PURPOSE: xterm re-measures the character
    // cell during its render pass, so fitting synchronously here divides the
    // pane by the OLD cell size and ships the remote program a geometry that
    // does not match what is on screen.
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // Pane not laid out (hidden tab) — the ResizeObserver refits on reveal.
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [fontSize]);

  useEffect(() => {
    const search = searchRef.current;
    if (!search) return;
    const q = searchQuery.trim();
    if (!q) {
      search.clearDecorations();
      return;
    }
    // `decorations` makes the addon mark every match, not just the active one.
    search.findNext(q, {
      incremental: true,
      decorations: {
        matchBackground: cssVar('--warning', '#d97706'),
        matchOverviewRuler: cssVar('--warning', '#d97706'),
        activeMatchBackground: cssVar('--accent', '#0d9488'),
        activeMatchColorOverviewRuler: cssVar('--accent', '#0d9488'),
      },
    });
  }, [searchQuery]);

  return <div ref={hostRef} className={styles.term} data-testid={`term-${label}`} aria-label={`Terminal ${label}`} />;
}
