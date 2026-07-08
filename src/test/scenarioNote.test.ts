import { describe, it, expect } from 'vitest';
import { splitScenarioNote } from '../pages/run/scenarioNote';

// NIM-73 A2: описание сценария делится на ВЕДУЩИЙ абзац (заметный info-callout над
// полями — для day-2 add_user/update_users это предусловие про пред-сид пароля) и
// остаток (тускло под полями). Абзацы folded-YAML разделены \n.
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
