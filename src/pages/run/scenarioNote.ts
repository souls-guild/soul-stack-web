// splitScenarioNote делит описание сценария на ВЕДУЩИЙ абзац (первый) и остаток.
// Ведущий рендерится заметным info-callout НАД полями формы запуска — оператор
// видит его ДО запуска и не пропускает (NIM-73: для day-2 add_user/update_users
// это заметка-предусловие про пред-сид пароля юзера в Vault). Остаток — тускло
// под полями. Абзацы folded-YAML разделены \n (внутри абзаца переносов нет).
// Источник — scenario.description (source-of-truth); UI не хардкодит текст под
// конкретный сценарий.
export function splitScenarioNote(description?: string): { lead: string; rest: string } {
  const paras = (description ?? '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { lead: paras[0] ?? '', rest: paras.slice(1).join('\n') };
}
