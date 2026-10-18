import { isObject } from './equal';
import { Conflict, Schema, Side } from './types';

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

const childSchema = (schema: Schema, step: string): Schema => {
  if (schema.type === 'object') {
    const named =
      schema.fields && Object.hasOwn(schema.fields, step) ? schema.fields[step] : undefined;
    return named ?? schema.each ?? { type: 'record' };
  }
  return { type: 'record' };
};

const setAt = (data: unknown, schema: Schema, path: string[], value: unknown): unknown => {
  if (path.length === 0) return value;
  const [step, ...rest] = path;
  if (schema.type === 'keyed') {
    const list = Array.isArray(data) ? data : [];
    const index = list.findIndex((item) => isObject(item) && item[schema.key] === step);
    const next = setAt(index >= 0 ? list[index] : undefined, schema.item, rest, value);
    if (index < 0) return next === undefined ? list : [...list, next];
    if (next === undefined) return list.filter((_, i) => i !== index);
    return list.map((item, i) => (i === index ? next : item));
  }
  const object = isObject(data) ? data : {};
  const next = setAt(own(object, step), childSchema(schema, step), rest, value);
  if (next === undefined) {
    return Object.fromEntries(Object.entries(object).filter(([key]) => key !== step));
  }
  return { ...object, [step]: next };
};

/**
 * Puts the value of one side of a conflict into the merged data. The player uses this to pick the
 * side that the merge did not take. A side that holds no value removes the entry.
 */
export const resolveConflict = (
  merged: unknown,
  schema: Schema,
  conflict: Conflict,
  side: Side,
): unknown => setAt(merged, schema, conflict.path, conflict[side]);
