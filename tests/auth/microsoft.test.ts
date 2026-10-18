import { microsoftAuthorizeUrl, ONEDRIVE_FILE_SCOPE, ONEDRIVE_SCOPES } from '@/auth/microsoft';

describe('microsoftAuthorizeUrl()', () => {
  it('asks personal accounts for a code, the app folder scope and a refresh token', () => {
    const url = new URL(microsoftAuthorizeUrl('id-1', 'https://site.test/sync/callback', 's 1'));
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'id-1',
      redirect_uri: 'https://site.test/sync/callback',
      response_type: 'code',
      response_mode: 'query',
      scope: 'Files.ReadWrite.AppFolder offline_access',
      state: 's 1',
    });
  });

  it('asks for the app folder and offline access only', () => {
    expect(ONEDRIVE_FILE_SCOPE).toBe('Files.ReadWrite.AppFolder');
    expect(ONEDRIVE_SCOPES).toEqual(['Files.ReadWrite.AppFolder', 'offline_access']);
  });
});
