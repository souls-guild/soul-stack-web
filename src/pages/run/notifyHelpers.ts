/**
 * Вспомогательные функции для notify-блока RunWizard.
 * В отдельном файле чтобы не нарушать react-refresh/only-export-components.
 */
import type { VoyageNotify } from '../../api/keeper';

/**
 * Сериализует notify-элементы для отправки в API.
 * Пустой herald — элемент невалиден, пропускается.
 * Projection без непустых путей — не шлём. Annotations пустые — не шлём.
 */
export function serializeNotify(items: VoyageNotify[]): VoyageNotify[] | undefined {
  const valid = items.filter((it) => it.herald.trim());
  if (!valid.length) return undefined;
  return valid.map((it) => {
    const out: VoyageNotify = {
      herald: it.herald,
      only_failures: it.only_failures ?? false,
      only_changes: it.only_changes ?? false,
    };
    if (it.on && it.on.length > 0) out.on = it.on;
    const ann = it.annotations as Record<string, unknown> | undefined;
    if (ann && Object.keys(ann).length > 0) out.annotations = ann;
    const proj = it.projection?.filter((p) => p.trim());
    if (proj && proj.length > 0) out.projection = proj;
    return out;
  });
}
