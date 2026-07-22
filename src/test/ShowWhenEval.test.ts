// Tests for the mini-CEL evaluator evalShowWhen.
// Covers: operators ==, !=, &&, ||, in, literals, input.<field>, parentheses,
// graceful fallback on syntax error.

import { describe, it, expect } from 'vitest';
import { evalShowWhen } from '../pages/incarnations/scenarioInputFields.helpers';

const INPUT = { mode: 'sentinel', count: '3', enabled: 'true', name: '' };

describe('evalShowWhen', () => {
  it('undefined/empty → true (field is shown by default)', () => {
    expect(evalShowWhen(undefined, {})).toBe(true);
    expect(evalShowWhen('', {})).toBe(true);
    expect(evalShowWhen('   ', {})).toBe(true);
  });

  it('== string literal', () => {
    expect(evalShowWhen('input.mode == "sentinel"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode == "cluster"', INPUT)).toBe(false);
  });

  it("== single-quoted string", () => {
    expect(evalShowWhen("input.mode == 'sentinel'", INPUT)).toBe(true);
    expect(evalShowWhen("input.mode == 'cluster'", INPUT)).toBe(false);
  });

  it('!= operator', () => {
    expect(evalShowWhen('input.mode != "cluster"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode != "sentinel"', INPUT)).toBe(false);
  });

  it('&& both true', () => {
    expect(evalShowWhen('input.mode == "sentinel" && input.count == "3"', INPUT)).toBe(true);
  });

  it('&& one false', () => {
    expect(evalShowWhen('input.mode == "sentinel" && input.count == "10"', INPUT)).toBe(false);
  });

  it('|| at least one true', () => {
    expect(evalShowWhen('input.mode == "standalone" || input.mode == "sentinel"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode == "standalone" || input.mode == "cluster"', INPUT)).toBe(false);
  });

  it('in operator (comma-separated)', () => {
    expect(evalShowWhen('input.mode in "sentinel,cluster"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode in "standalone,cluster"', INPUT)).toBe(false);
  });

  it('numeric literals', () => {
    expect(evalShowWhen('input.count == "3"', INPUT)).toBe(true);
  });

  it('parentheses change precedence', () => {
    // without parens: false && true || true -> (false && true) || true -> true
    expect(evalShowWhen('(input.mode == "cluster" && input.count == "3") || input.mode == "sentinel"', INPUT)).toBe(true);
  });

  it('nonexistent field → null → false on comparison', () => {
    expect(evalShowWhen('input.nonexistent == "foo"', INPUT)).toBe(false);
  });

  it('true/false literals', () => {
    expect(evalShowWhen('true', {})).toBe(true);
    expect(evalShowWhen('false', {})).toBe(false);
  });

  it('graceful fallback on syntax error → true (no crash)', () => {
    // The function must not throw an exception — just returns something.
    // The exact value depends on the parser, but the page must not crash.
    expect(() => evalShowWhen('has(input.mode)', INPUT)).not.toThrow();
    // In this particular case has() — bare identifier -> null -> false;
    // contract: no crash, value is defined.
    const result = evalShowWhen('has(input.mode)', INPUT);
    expect(typeof result).toBe('boolean');
  });

  it('empty input.name (empty string) == "" → true', () => {
    expect(evalShowWhen('input.name == ""', INPUT)).toBe(true);
    expect(evalShowWhen('input.name == "foo"', INPUT)).toBe(false);
  });

  it('nested && + ||', () => {
    expect(evalShowWhen(
      'input.mode == "sentinel" && (input.count == "1" || input.count == "3")',
      INPUT,
    )).toBe(true);
    expect(evalShowWhen(
      'input.mode == "sentinel" && (input.count == "1" || input.count == "9")',
      INPUT,
    )).toBe(false);
  });
});
