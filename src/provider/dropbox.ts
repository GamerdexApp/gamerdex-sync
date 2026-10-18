import { detailOf } from './detail';
import { ProviderError, RemoteFile, SyncProvider, VersionConflictError } from './types';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

export interface DropboxOptions {
  /** Returns the token. It may refresh the token first, so it is called for every request. */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
}

interface Failure {
  status: number;
  tags: Set<string>;
  detail: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A header value must be ASCII, so every other character of the JSON is written as an escape. */
const headerJson = (value: unknown): string =>
  JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

/** Collects the `.tag` values of an error. Dropbox names each failure by a chain of tags. */
const tagsOf = (value: unknown, found = new Set<string>()): Set<string> => {
  if (!isRecord(value)) return found;
  for (const [key, entry] of Object.entries(value)) {
    if (key === '.tag' && typeof entry === 'string') found.add(entry);
    else tagsOf(entry, found);
  }
  return found;
};

const retryAfterOf = (response: Response, body: unknown): number | undefined => {
  const header = response.headers.get('retry-after');
  if (header !== null && Number.isFinite(Number(header))) return Number(header);
  const seconds = isRecord(body) && isRecord(body.error) ? body.error.retry_after : undefined;
  return typeof seconds === 'number' ? seconds : undefined;
};

/**
 * Keeps the files of an app in the Dropbox of the player. The app should have the App folder
 * access type with the `files.content.read` and `files.content.write` scopes, so it sees only its
 * own folder under `Apps`.
 *
 * Dropbox writes with an expected revision. An upload in `update` mode with `strict_conflict`
 * fails when the file changed since, and an upload in `add` mode fails when the file exists.
 */
export class DropboxProvider implements SyncProvider {
  private readonly send: typeof fetch;

  constructor(private readonly options: DropboxOptions) {
    this.send = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async read(path: string): Promise<RemoteFile | null> {
    const response = await this.request(`${CONTENT}/files/download`, {
      'Dropbox-API-Arg': headerJson({ path: `/${path}` }),
    });
    if (!response.ok) {
      const failure = await this.failure(response);
      if (failure.tags.has('not_found')) return null;
      throw this.unexpected(failure);
    }
    const result: unknown = JSON.parse(response.headers.get('dropbox-api-result') ?? 'null');
    if (!isRecord(result) || typeof result.rev !== 'string') {
      throw this.invalid('The file has no version.');
    }
    return { content: await response.text(), version: result.rev };
  }

  async write(
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }> {
    const mode =
      expectedVersion === null ? { '.tag': 'add' } : { '.tag': 'update', update: expectedVersion };
    const response = await this.request(
      `${CONTENT}/files/upload`,
      {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': headerJson({
          path: `/${path}`,
          mode,
          autorename: false,
          mute: true,
          strict_conflict: true,
        }),
      },
      content,
    );
    if (!response.ok) {
      const failure = await this.failure(response);
      if (failure.tags.has('conflict')) throw new VersionConflictError(path);
      throw this.unexpected(failure);
    }
    const result: unknown = await response.json().catch(() => null);
    if (!isRecord(result) || typeof result.rev !== 'string') {
      throw this.invalid('The write returned no version.');
    }
    return { version: result.rev };
  }

  async remove(path: string, expectedVersion: string): Promise<void> {
    const response = await this.request(
      `${API}/files/delete_v2`,
      { 'Content-Type': 'application/json' },
      JSON.stringify({ path: `/${path}`, parent_rev: expectedVersion }),
    );
    if (response.ok) return;
    const failure = await this.failure(response);
    if (failure.tags.has('conflict')) throw new VersionConflictError(path);
    if (failure.tags.has('not_found')) {
      if ((await this.read(path)) !== null) throw new VersionConflictError(path);
      return;
    }
    throw this.unexpected(failure);
  }

  private async request(
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<Response> {
    const token = await this.options.getToken();
    try {
      return await this.send(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
    } catch {
      throw new ProviderError('network', 'Dropbox could not be reached.');
    }
  }

  /**
   * Reads a failed answer. Dropbox reports a failure that belongs to the call, such as a missing
   * file or a conflict, with status 409. The caller decides what that means. Every other status
   * is a failure of the request and is thrown here.
   */
  private async failure(response: Response): Promise<Failure> {
    const { status } = response;
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const detail = await detailOf(response);
    if (status === 409) return { status, tags: tagsOf(isRecord(body) ? body.error : null), detail };
    if (status === 401) {
      throw new ProviderError('auth', 'The token is not valid.', status, undefined, detail);
    }
    if (status === 403) {
      throw new ProviderError(
        'auth',
        'The token has no permission for Dropbox.',
        status,
        undefined,
        detail,
      );
    }
    if (status === 429) {
      throw new ProviderError(
        'rate-limit',
        'Dropbox limits the calls.',
        status,
        retryAfterOf(response, body),
        detail,
      );
    }
    if (status >= 500) {
      throw new ProviderError('server', 'Dropbox failed.', status, undefined, detail);
    }
    throw this.invalid(`Dropbox answered ${status}.`, status, detail);
  }

  private unexpected({ status, tags, detail }: Failure): ProviderError {
    if (tags.has('too_many_write_operations')) {
      return new ProviderError(
        'rate-limit',
        'Dropbox limits the writes.',
        status,
        undefined,
        detail,
      );
    }
    if (tags.has('no_write_permission')) {
      return new ProviderError(
        'auth',
        'The token has no permission for Dropbox.',
        status,
        undefined,
        detail,
      );
    }
    if (tags.has('insufficient_space')) {
      return this.invalid('Dropbox has no space left.', status, detail);
    }
    return this.invalid(`Dropbox answered ${status}.`, status, detail);
  }

  private invalid(message: string, status?: number, detail?: string): ProviderError {
    return new ProviderError('invalid', message, status, undefined, detail);
  }
}
