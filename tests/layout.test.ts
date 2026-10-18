import { dataPath, isAppId, metaPath, ROOT_FOLDER } from '@/layout';

describe('layout', () => {
  it('names the data and meta file of an app inside the shared folder', () => {
    expect(ROOT_FOLDER).toBe('Gamerdex');
    expect(dataPath('whiteout-survival')).toBe('Gamerdex/whiteout-survival/data.json');
    expect(metaPath('whiteout-survival')).toBe('Gamerdex/whiteout-survival/meta.json');
  });

  it('accepts lowercase words joined by single dashes as an app id', () => {
    expect(isAppId('whiteout-survival')).toBe(true);
    expect(isAppId('stardew2')).toBe(true);
  });

  it('rejects an app id that cannot name a folder', () => {
    for (const bad of ['', 'Whiteout', 'a_b', 'a--b', '-a', 'a-', 'a/b', '../x']) {
      expect(isAppId(bad)).toBe(false);
      expect(() => dataPath(bad)).toThrow(RangeError);
      expect(() => metaPath(bad)).toThrow(RangeError);
    }
  });
});
