import type { TFunction } from 'i18next';
import type { RunFailure } from '../../api/keeper';

// Why and where a failed run stopped (NIM-1000). The keeper records it on the run's
// terminal: `summary` for every failed run, the structured fields for a run recorded
// since they exist. Steps and plan indices are 0-based, as on the hosts and the task list.

export type FailureTask = NonNullable<RunFailure['tasks']>[number];

// The task the failure happened in — the innermost of the chain.
export function failedTask(f: RunFailure | undefined): FailureTask | undefined {
  const tasks = f?.tasks ?? [];
  return tasks.length > 0 ? tasks[tasks.length - 1] : undefined;
}

// A failure carries an address when the keeper took it apart; an older run has the text only.
export function hasAddress(f: RunFailure): boolean {
  return (f.tasks ?? []).length > 0 || f.cause != null;
}

export function causeText(f: RunFailure, t: TFunction): string {
  return f.cause_withheld ? t('runhistory:runFailureWithheld') : (f.cause ?? '');
}

// One line for a run list: step · task · cause, or the summary when there is no address.
export function failureLine(f: RunFailure, t: TFunction): string {
  if (!hasAddress(f)) return f.summary ?? f.code ?? '';
  const parts: string[] = [];
  if (f.step != null) parts.push(t('runhistory:runFailureStep', { step: f.step }));
  const task = failedTask(f);
  if (task?.name) parts.push(task.name);
  const cause = causeText(f, t);
  if (cause) parts.push(cause);
  return parts.join(' · ');
}

export function sourceAt(file: string | undefined, line: number | undefined): string | null {
  if (!file) return null;
  return line ? `${file}:${line}` : file;
}
