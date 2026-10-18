const MAX_DETAIL_LENGTH = 300;

/** Reads the `message` that GitHub sends with a failed request, for the logs and the player. */
export const detailOf = async (response: Response): Promise<string | undefined> => {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return undefined;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message.slice(0, MAX_DETAIL_LENGTH) : undefined;
};
