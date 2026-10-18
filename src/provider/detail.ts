const MAX_DETAIL_LENGTH = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads the message that a provider sends with a failed request, for the logs and the player.
 * GitHub sends `{ message }`, Google and Microsoft send `{ error: { message } }` and Dropbox sends
 * `{ error_summary }`.
 */
export const detailOf = async (response: Response): Promise<string | undefined> => {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return undefined;
  const nested = isRecord(body.error) ? body.error.message : undefined;
  const message = nested ?? body.message ?? body.error_summary;
  return typeof message === 'string' ? message.slice(0, MAX_DETAIL_LENGTH) : undefined;
};
