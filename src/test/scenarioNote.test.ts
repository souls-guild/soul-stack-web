import { describe, it, expect } from 'vitest';
import { splitScenarioNote } from '../pages/run/scenarioNote';

// NIM-73 A2: описание сценария делится на ВЕДУЩИЙ абзац (заметный info-callout над
// полями — для операционных add_user/update_users это предусловие про пред-сид пароля) и
// остаток (тускло под полями). Абзацы folded-YAML разделены \n.
describe('splitScenarioNote', () => {
  it('делит описание на ведущий абзац (callout) и остаток (тускло)', () => {
    const { lead, rest } = splitScenarioNote(
      '★ Перед запуском засей пароль добавляемого юзера в Vault\n\nДобавить или переопределить одного ACL-пользователя на работающем Redis без рестарта.\nПароль берётся из Vault',
    );
    expect(lead).toBe('★ Перед запуском засей пароль добавляемого юзера в Vault');
    expect(rest).toContain('Добавить или переопределить одного ACL-пользователя на работающем Redis без рестарта.');
    expect(rest).toContain('Пароль берётся из Vault');
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
