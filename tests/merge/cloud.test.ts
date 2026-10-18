import { restoreCloudValues } from '@/merge/cloud';
import { Schema } from '@/merge/types';

const local: Schema = { type: 'local' };
const record: Schema = { type: 'record' };

describe('restoreCloudValues()', () => {
  it('puts the cloud value in place of a device value', () => {
    expect(restoreCloudValues('two', 'one', local)).toBe('one');
    expect(restoreCloudValues('two', undefined, local)).toBeUndefined();
  });

  it('returns the data as it is when the schema holds no device value', () => {
    const data = { a: 1 };
    expect(restoreCloudValues(data, { a: 2 }, { type: 'object', each: record })).toBe(data);
    expect(restoreCloudValues(data, { a: 2 }, { type: 'keyed', key: 'id', item: record })).toBe(
      data,
    );
    expect(restoreCloudValues(1, 2, { type: 'join' })).toBe(1);
  });

  const schema: Schema = {
    type: 'object',
    fields: { active: local, nested: { type: 'object', fields: { device: local } } },
    each: record,
  };

  it('restores a device field and keeps the other fields of the merged data', () => {
    expect(restoreCloudValues({ active: 'two', x: 5 }, { active: 'one', x: 1 }, schema)).toEqual({
      active: 'one',
      x: 5,
    });
  });

  it('restores a device field that only the cloud holds and removes one the cloud lacks', () => {
    expect(restoreCloudValues({ x: 5 }, { active: 'one' }, schema)).toEqual({
      active: 'one',
      x: 5,
    });
    expect(restoreCloudValues({ active: 'two', x: 5 }, { x: 1 }, schema)).toEqual({ x: 5 });
  });

  it('reaches device values in nested objects', () => {
    expect(
      restoreCloudValues({ nested: { device: 'b', k: 1 } }, { nested: { device: 'a' } }, schema),
    ).toEqual({ nested: { device: 'a', k: 1 } });
  });

  it('uses the each schema for a name the schema does not list', () => {
    const eachLocal: Schema = { type: 'object', each: local };
    expect(restoreCloudValues({ a: 2, b: 3 }, { a: 1 }, eachLocal)).toEqual({ a: 1 });
  });

  it('uses a record for a name when there is no each schema', () => {
    const fieldsOnly: Schema = { type: 'object', fields: { active: local } };
    expect(restoreCloudValues({ active: 'b', x: 1 }, { active: 'a' }, fieldsOnly)).toEqual({
      active: 'a',
      x: 1,
    });
  });

  it('restores the device values of the entries of a keyed list by id', () => {
    const keyed: Schema = {
      type: 'keyed',
      key: 'id',
      item: { type: 'object', fields: { open: local }, each: record },
    };
    const merged = [{ id: 'a', open: 'yes', n: 2 }, { id: 'b', open: 'yes', n: 3 }, 'stray'];
    const remote = [{ id: 'a', open: 'no', n: 1 }, 'stray'];
    expect(restoreCloudValues(merged, remote, keyed)).toEqual([
      { id: 'a', open: 'no', n: 2 },
      { id: 'b', n: 3 },
      'stray',
    ]);
  });

  it('returns the merged data when the shapes do not match the schema', () => {
    expect(restoreCloudValues('text', { active: 'a' }, schema)).toBe('text');
    expect(restoreCloudValues({ a: 1 }, 'text', schema)).toEqual({ a: 1 });
    const keyed: Schema = { type: 'keyed', key: 'id', item: local };
    expect(restoreCloudValues({ id: 'a' }, [{ id: 'a' }], keyed)).toEqual({ id: 'a' });
    expect(restoreCloudValues([{ id: 'a' }], 'text', keyed)).toEqual([{ id: 'a' }]);
  });
});
