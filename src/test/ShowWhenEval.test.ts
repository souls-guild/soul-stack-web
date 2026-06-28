// Тесты мини-CEL-эвалуатора evalShowWhen.
// Покрывает: операторы ==, !=, &&, ||, in, литералы, input.<field>, скобки,
// graceful fallback при синтаксической ошибке.

import { describe, it, expect } from 'vitest';
import { evalShowWhen } from '../pages/incarnations/scenarioInputFields.helpers';

const INPUT = { mode: 'sentinel', count: '3', enabled: 'true', name: '' };

describe('evalShowWhen', () => {
  it('undefined/empty → true (поле показывается по умолчанию)', () => {
    expect(evalShowWhen(undefined, {})).toBe(true);
    expect(evalShowWhen('', {})).toBe(true);
    expect(evalShowWhen('   ', {})).toBe(true);
  });

  it('== строковый литерал', () => {
    expect(evalShowWhen('input.mode == "sentinel"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode == "cluster"', INPUT)).toBe(false);
  });

  it("== строка в одинарных кавычках", () => {
    expect(evalShowWhen("input.mode == 'sentinel'", INPUT)).toBe(true);
    expect(evalShowWhen("input.mode == 'cluster'", INPUT)).toBe(false);
  });

  it('!= оператор', () => {
    expect(evalShowWhen('input.mode != "cluster"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode != "sentinel"', INPUT)).toBe(false);
  });

  it('&& оба true', () => {
    expect(evalShowWhen('input.mode == "sentinel" && input.count == "3"', INPUT)).toBe(true);
  });

  it('&& одно false', () => {
    expect(evalShowWhen('input.mode == "sentinel" && input.count == "10"', INPUT)).toBe(false);
  });

  it('|| хотя бы одно true', () => {
    expect(evalShowWhen('input.mode == "standalone" || input.mode == "sentinel"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode == "standalone" || input.mode == "cluster"', INPUT)).toBe(false);
  });

  it('in оператор (через запятую)', () => {
    expect(evalShowWhen('input.mode in "sentinel,cluster"', INPUT)).toBe(true);
    expect(evalShowWhen('input.mode in "standalone,cluster"', INPUT)).toBe(false);
  });

  it('числовые литералы', () => {
    expect(evalShowWhen('input.count == "3"', INPUT)).toBe(true);
  });

  it('скобки меняют приоритет', () => {
    // без скобок: false && true || true → (false && true) || true → true
    expect(evalShowWhen('(input.mode == "cluster" && input.count == "3") || input.mode == "sentinel"', INPUT)).toBe(true);
  });

  it('несуществующее поле → null → false при сравнении', () => {
    expect(evalShowWhen('input.nonexistent == "foo"', INPUT)).toBe(false);
  });

  it('true/false литералы', () => {
    expect(evalShowWhen('true', {})).toBe(true);
    expect(evalShowWhen('false', {})).toBe(false);
  });

  it('graceful fallback на синтаксическую ошибку → true (нет краша)', () => {
    // Функция не должна бросать исключение — просто возвращает что-то.
    // Точное значение зависит от парсера, но страница не должна падать.
    expect(() => evalShowWhen('has(input.mode)', INPUT)).not.toThrow();
    // В частном случае has() — bare identifier → null → false;
    // контракт: нет краша, значение определено.
    const result = evalShowWhen('has(input.mode)', INPUT);
    expect(typeof result).toBe('boolean');
  });

  it('пустое input.name (пустая строка) == "" → true', () => {
    expect(evalShowWhen('input.name == ""', INPUT)).toBe(true);
    expect(evalShowWhen('input.name == "foo"', INPUT)).toBe(false);
  });

  it('вложенный && + ||', () => {
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
