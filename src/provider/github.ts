import { decodeBase64, encodeBase64 } from './base64';
import { ProviderError, RemoteFile, SyncProvider, VersionConflictError } from './types';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export interface GitHubOptions {
  /** The owner and the name of the repository, such as `chiefpansancolt/gamerdex-data`. */
  repository: string;
  /** Returns the token. It may refresh the token first, so it is called for every request. */
  getToken: () => Promise<string>;
  /** The branch to use. Without it GitHub uses the default branch of the repository. */
  branch?: string;
  /** The message of the commit that a write or a removal makes. */
  commitMessage?: (path: string) => string;
  fetch?: typeof fetch;
}

export interface RepositoryCheck {
  private: boolean;
  canWrite: boolean;
  defaultBranch: string;
}

interface ContentsResponse {
  sha?: unknown;
  content?: unknown;
  encoding?: unknown;
}

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const retryAfterOf = (response: Response): number | undefined => {
  const header = response.headers.get('retry-after');
  if (header !== null && Number.isFinite(Number(header))) return Number(header);
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset !== null && Number.isFinite(Number(reset))) {
    return Math.max(0, Number(reset) - Math.floor(Date.now() / 1000));
  }
  return undefined;
};

/** Keeps the files of an app in a private GitHub repository, through the contents API. */
export class GitHubProvider implements SyncProvider {
  private readonly send: typeof fetch;

  constructor(private readonly options: GitHubOptions) {
    this.send = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async read(path: string): Promise<RemoteFile | null> {
    const response = await this.request('GET', this.contentsUrl(path));
    if (response.status === 404) return null;
    await this.assertOk(response);
    const body = (await response.json()) as ContentsResponse;
    if (typeof body.sha !== 'string') throw this.invalid('The file has no version.');
    if (body.encoding === 'base64' && typeof body.content === 'string') {
      return { content: decodeBase64(body.content), version: body.sha };
    }
    if (body.encoding === 'none') {
      const raw = await this.request('GET', this.contentsUrl(path), undefined, {
        Accept: 'application/vnd.github.raw+json',
      });
      await this.assertOk(raw);
      return { content: await raw.text(), version: body.sha };
    }
    throw this.invalid('The file content is not in a known encoding.');
  }

  async write(
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }> {
    const body: Record<string, unknown> = {
      message: this.message(path),
      content: encodeBase64(content),
    };
    if (expectedVersion !== null) body.sha = expectedVersion;
    if (this.options.branch) body.branch = this.options.branch;
    const response = await this.request('PUT', this.contentsUrl(path), body);
    if (response.status === 409 || response.status === 422) throw new VersionConflictError(path);
    await this.assertOk(response);
    const result = (await response.json()) as { content?: { sha?: unknown } };
    const version = result.content?.sha;
    if (typeof version !== 'string') throw this.invalid('The write returned no version.');
    return { version };
  }

  async remove(path: string, expectedVersion: string): Promise<void> {
    const body: Record<string, unknown> = { message: this.message(path), sha: expectedVersion };
    if (this.options.branch) body.branch = this.options.branch;
    const response = await this.request('DELETE', this.contentsUrl(path), body);
    if (response.status === 404) return;
    if (response.status === 409 || response.status === 422) throw new VersionConflictError(path);
    await this.assertOk(response);
  }

  /**
   * Checks that the repository can be used: it exists, the token can write to it, and it is
   * private. The saved data of a player must never sit in a public repository.
   */
  async checkRepository(): Promise<RepositoryCheck> {
    const response = await this.request('GET', `${API}/repos/${this.options.repository}`);
    await this.assertOk(response);
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.private !== 'boolean') {
      throw this.invalid('The repository answer is not understood.');
    }
    const permissions = isRecord(body.permissions) ? body.permissions : {};
    return {
      private: body.private,
      canWrite: permissions.push === true,
      defaultBranch: typeof body.default_branch === 'string' ? body.default_branch : 'main',
    };
  }

  private contentsUrl(path: string): string {
    const base = `${API}/repos/${this.options.repository}/contents/${encodePath(path)}`;
    return this.options.branch ? `${base}?ref=${encodeURIComponent(this.options.branch)}` : base;
  }

  private message(path: string): string {
    return this.options.commitMessage?.(path) ?? `Gamerdex sync: ${path}`;
  }

  private async request(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const token = await this.options.getToken();
    try {
      return await this.send(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ProviderError('network', 'GitHub could not be reached.');
    }
  }

  private async assertOk(response: Response): Promise<void> {
    if (response.ok) return;
    const { status } = response;
    if (status === 401) throw new ProviderError('auth', 'The token is not valid.', status);
    if (status === 403 || status === 429) {
      const limited = status === 429 || response.headers.get('x-ratelimit-remaining') === '0';
      if (limited) {
        throw new ProviderError(
          'rate-limit',
          'GitHub limits the calls.',
          status,
          retryAfterOf(response),
        );
      }
      throw new ProviderError('auth', 'The token has no permission for the repository.', status);
    }
    if (status === 404)
      throw new ProviderError('not-found', 'The repository was not found.', status);
    if (status >= 500) throw new ProviderError('server', 'GitHub failed.', status);
    throw this.invalid(`GitHub answered ${status}.`, status);
  }

  private invalid(message: string, status?: number): ProviderError {
    return new ProviderError('invalid', message, status);
  }
}
