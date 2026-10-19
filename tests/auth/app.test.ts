import { CLIENT_IDS, GITHUB_APP } from '@/auth/app';

describe('CLIENT_IDS', () => {
  it('has the Google client ID in the form that Google issues', () => {
    expect(CLIENT_IDS.google).toMatch(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  });

  it('has the Microsoft application ID as a GUID', () => {
    expect(CLIENT_IDS.microsoft).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('has the Dropbox app key as 15 letters and digits', () => {
    expect(CLIENT_IDS.dropbox).toMatch(/^[a-z0-9]{15}$/);
  });

  it('gives each provider a different ID, and none is the GitHub one', () => {
    const ids = [...Object.values(CLIENT_IDS), GITHUB_APP.clientId];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
