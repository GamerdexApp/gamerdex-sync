/** The file scope that sync asks for. It reaches only the app folder of the player. */
export const ONEDRIVE_FILE_SCOPE = 'Files.ReadWrite.AppFolder';

/** The file scope, and `offline_access`, which makes Microsoft send a refresh token. */
export const ONEDRIVE_SCOPES = [ONEDRIVE_FILE_SCOPE, 'offline_access'] as const;

/** The address of the Microsoft sign in page for personal accounts. */
export const microsoftAuthorizeUrl = (
  clientId: string,
  redirectUri: string,
  state: string,
): string => {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: ONEDRIVE_SCOPES.join(' '),
    state,
  });
  return `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${query}`;
};
