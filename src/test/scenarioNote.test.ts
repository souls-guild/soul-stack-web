import { describe, it, expect } from 'vitest';
import { splitScenarioNote } from '../pages/run/scenarioNote';

// NIM-73 A2: scenario description splits into a LEADING paragraph (a prominent
// info-callout above the fields — for add_user/update_users this is the precondition
// about pre-seeding the password) and the rest (muted, below the fields). folded-YAML
// paragraphs are separated by \n.
describe('splitScenarioNote', () => {
  it('делит описание на ведущий абзац (callout) и остаток (тускло)', () => {
    const { lead, rest } = splitScenarioNote(
      '★ Перед запуском засей пароль в Vault\n\nDay-2: добавить ACL-юзера\nещё деталь',
    );
    expect(lead).toBe('★ Перед запуском засей пароль в Vault');
    expect(rest).toContain('Day-2: добавить ACL-юзера');
    expect(rest).toContain('ещё деталь');
  });

  it('однопараграфное описание → всё в lead, rest пуст', () => {
    expect(splitScenarioNote('init')).toEqual({ lead: 'init', rest: '' });
  });

  it('пустое / undefined / только пробелы → пустые строки (callout не рендерится)', () => {
    expect(splitScenarioNote(undefined)).toEqual({ lead: '', rest: '' });
    expect(splitScenarioNote('')).toEqual({ lead: '', rest: '' });
    expect(splitScenarioNote('   ')).toEqual({ lead: '', rest: '' });
  });
});
