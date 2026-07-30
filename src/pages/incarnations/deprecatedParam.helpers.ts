import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';
import type { ScenarioFieldValue, ScenarioFieldsState } from './scenarioInputFields.helpers';

// NIM-243: state math behind the "switch to the successor" action offered on a
// deprecated module parameter.

function isBlank(v: ScenarioFieldValue): boolean {
  return v === undefined || (typeof v === 'string' && v.trim() === '');
}

// Value the deprecated field is left with after its content moves to the
// successor. Mirrors defaultsFromSchema so serializeFields drops the key
// (it skips undefined and '') and the run carries the successor only.
function clearedValue(prop: ScenarioInputSchemaProperty): ScenarioFieldValue {
  return prop.type === 'boolean' ? false : '';
}

/**
 * Next form state for "switch to the successor", or null when the move is not
 * unambiguously safe. Refuses when the successor is undeclared or typed
 * differently (the value would not survive the move), when there is nothing to
 * move, and when the successor already holds a value (moving would overwrite an
 * operator's input). The textual suggestion stands on its own in those cases —
 * only the one-click action is withheld.
 */
export function successorSwap(
  name: string,
  prop: ScenarioInputSchemaProperty,
  schema: ScenarioInputSchema,
  state: ScenarioFieldsState,
): ScenarioFieldsState | null {
  const successor = prop.deprecated?.use;
  if (!successor || successor === name) return null;
  const successorProp = (schema ?? {})[successor];
  if (!successorProp || successorProp.type !== prop.type) return null;
  if (isBlank(state[name]) || !isBlank(state[successor])) return null;
  return { ...state, [successor]: state[name], [name]: clearedValue(prop) };
}
