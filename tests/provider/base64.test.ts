import { decodeBase64, encodeBase64 } from '@/provider/base64';

describe('base64', () => {
  it('round trips plain text, accents and emoji', () => {
    for (const text of ['', 'abc', 'Ünïcödé 中文 🙂', '{"a":1}\n']) {
      expect(decodeBase64(encodeBase64(text))).toBe(text);
    }
  });

  it('matches the base64 that Node writes for the UTF-8 bytes', () => {
    expect(encodeBase64('héllo 🙂')).toBe(Buffer.from('héllo 🙂', 'utf8').toString('base64'));
  });

  it('handles text longer than one chunk', () => {
    const text = 'é🙂x'.repeat(40_000);
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('ignores line breaks in the base64 text', () => {
    const wrapped = (encodeBase64('hello world, a longer text').match(/.{1,8}/g) ?? []).join('\n');
    expect(decodeBase64(wrapped)).toBe('hello world, a longer text');
  });
});
