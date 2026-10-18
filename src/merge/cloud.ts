import { isObject } from './equal';
import { Schema } from './types';

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

const childSchema = (schema: Extract<Schema, { type: 'object' }>, key: string): Schema =>
  (schema.fields && Object.hasOwn(schema.fields, key) ? schema.fields[key] : undefined) ??
  schema.each ?? { type: 'record' };

const holdsDeviceValue = (schema: Schema): boolean => {
  if (schema.type === 'local') return true;
  if (schema.type === 'keyed') return holdsDeviceValue(schema.item);
  if (schema.type !== 'object') return false;
  return (
    (schema.each !== undefined && holdsDeviceValue(schema.each)) ||
    Object.values(schema.fields ?? {}).some(holdsDeviceValue)
  );
};

/**
 * Returns the merged data as it must be stored in the cloud: every part with the `local` strategy
 * keeps the value that the cloud already holds, so a value of one device never changes the cloud.
 */
export const restoreCloudValues = (merged: unknown, remote: unknown, schema: Schema): unknown => {
  if (schema.type === 'local') return remote;
  if (!holdsDeviceValue(schema)) return merged;

  if (schema.type === 'object' && isObject(merged) && (isObject(remote) || remote === undefined)) {
    const cloud = remote ?? {};
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(merged), ...Object.keys(cloud)])) {
      const child = childSchema(schema, key);
      const value = restoreCloudValues(own(merged, key), own(cloud, key), child);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  if (schema.type === 'keyed' && Array.isArray(merged) && Array.isArray(remote)) {
    const remoteById = new Map(
      remote.filter(isObject).map((item) => [item[schema.key], item] as const),
    );
    return merged.map((item) =>
      isObject(item)
        ? restoreCloudValues(item, remoteById.get(item[schema.key]), schema.item)
        : item,
    );
  }
  return merged;
};
