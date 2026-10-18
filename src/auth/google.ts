/** The only Drive scope that sync asks for. It sees the files that the app created itself. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * The address of the Google sign in page. `access_type=offline` and `prompt=consent` make Google
 * send a refresh token, which it otherwise sends only the first time the player agrees.
 */
export const googleAuthorizeUrl = (
  clientId: string,
  redirectUri: string,
  state: string,
): string => {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
};
