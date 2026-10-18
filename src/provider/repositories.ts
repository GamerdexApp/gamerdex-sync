import { ProviderError } from './types';

export interface InstalledRepository {
  /** The owner and the name, such as `chiefpansancolt/gamerdex-data`. */
  fullName: string;
  private: boolean;
}

const API = 'https://api.github.com';
const PAGE_SIZE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getJson = async (
  send: typeof fetch,
  token: string,
  url: string,
): Promise<Record<string, unknown>> => {
  let response: Response;
  try {
    response = await send(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    throw new ProviderError('network', 'GitHub could not be reached.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError('auth', 'The token is not valid.', response.status);
  }
  if (response.status >= 500) throw new ProviderError('server', 'GitHub failed.', response.status);
  const body: unknown = response.ok ? await response.json().catch(() => null) : null;
  if (!isRecord(body))
    throw new ProviderError('invalid', 'GitHub answer is not understood.', response.status);
  return body;
};

/**
 * Lists the repositories that the player gave to the GitHub App, for the first 100 installations
 * and the first 100 repositories of each. The player picks the repository for the synced data.
 */
export const listInstalledRepositories = async (
  token: string,
  send: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<InstalledRepository[]> => {
  const installations = await getJson(
    send,
    token,
    `${API}/user/installations?per_page=${PAGE_SIZE}`,
  );
  const ids = (Array.isArray(installations.installations) ? installations.installations : [])
    .filter(isRecord)
    .map((installation) => installation.id)
    .filter((id): id is number => typeof id === 'number');

  const repositories: InstalledRepository[] = [];
  for (const id of ids) {
    const page = await getJson(
      send,
      token,
      `${API}/user/installations/${id}/repositories?per_page=${PAGE_SIZE}`,
    );
    for (const item of Array.isArray(page.repositories) ? page.repositories : []) {
      if (
        isRecord(item) &&
        typeof item.full_name === 'string' &&
        typeof item.private === 'boolean'
      ) {
        repositories.push({ fullName: item.full_name, private: item.private });
      }
    }
  }
  return repositories;
};
