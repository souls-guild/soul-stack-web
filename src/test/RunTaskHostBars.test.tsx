/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { RunTasks } from '../pages/incarnations/RunTasks';
import type { RunTaskView } from '../api/keeper';

// The host bars of a task row: one `<i>` per host of that task, coloured by its
// status. Two properties, and they are guarded in two different places because
// one of them is not a DOM fact at all.
//
// jsdom applies no CSS-module stylesheet, so "do the bars wrap" cannot be read
// off the rendered tree — a computed style here answers with the empty string
// whatever the sheet says. The layout is therefore guarded by reading the
// stylesheet, which is exactly where the defect lived (NIM-896): `.hbar` was a
// single flex row with `flex-shrink: 0`, so nine hosts occupied 160px and a
// 23-entry batch over 400px of a row that also carries the task's index, name and
// module chip — and the name is what got pushed out.
const CSS = readFileSync(
  path.resolve(__dirname, '../pages/incarnations/RunTasks.module.css'),
  'utf8',
);

type TaskHost = NonNullable<RunTaskView['hosts']>[number];

function hostsOf(n: number): TaskHost[] {
  return Array.from({ length: n }, (_, i) => ({
    sid: `h${i + 1}.local`,
    status: i === 0 ? ('TASK_STATUS_FAILED' as const) : ('TASK_STATUS_OK' as const),
  }));
}

describe('run task host bars', () => {
  it('draws one bar per host, each naming its host and status', () => {
    const tasks: RunTaskView[] = [
      { plan_index: 0, passage: 0, id: 'Install redis', module: 'core.pkg.installed', hosts: hostsOf(9) },
    ];
    renderWithProviders(<RunTasks tasks={tasks} />, '/');

    const bars = screen.getByTestId('run-task-hostbar-0').querySelectorAll('i');
    expect(bars).toHaveLength(9);
    // The tooltip is the only way to tell which bar is which host, so a bar
    // without one is a coloured pixel and nothing more.
    expect(Array.from(bars).map((b) => b.getAttribute('title'))).toEqual([
      'h1.local: TASK_STATUS_FAILED',
      ...Array.from({ length: 8 }, (_, i) => `h${i + 2}.local: TASK_STATUS_OK`),
    ]);
  });

  it('a 23-host task still draws every bar', () => {
    const tasks: RunTaskView[] = [
      { plan_index: 0, passage: 0, id: 'Register souls', module: 'core.soul.registered', hosts: hostsOf(23) },
    ];
    renderWithProviders(<RunTasks tasks={tasks} />, '/');

    expect(screen.getByTestId('run-task-hostbar-0').querySelectorAll('i')).toHaveLength(23);
  });

  // The layout half, read off the stylesheet: the bars must be laid out in a
  // BOUNDED number of columns, so the block's width stops depending on how many
  // hosts the run has. A flex row without wrapping is the shape that failed.
  it('the stylesheet lays the bars out in bounded columns', () => {
    const hbar = CSS.match(/\.hbar\s*\{([^}]*)\}/);
    expect(hbar, '.hbar rule is gone — the bars are unstyled').not.toBeNull();
    const rule = hbar![1];

    const grid = /display:\s*grid/.test(rule) && /grid-template-columns:\s*repeat\(\s*\d+/.test(rule);
    const wrappingFlex = /display:\s*flex/.test(rule) && /flex-wrap:\s*wrap/.test(rule);
    expect(
      grid || wrappingFlex,
      '.hbar must be a grid with a fixed column count or a wrapping flex row; ' +
        'a single non-wrapping row grows with the host count and pushes the task name out',
    ).toBe(true);
  });
});
