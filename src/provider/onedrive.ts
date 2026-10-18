import { detailOf } from './detail';
import { ProviderError, RemoteFile, SyncProvider, VersionConflictError } from './types';

const APP_FOLDER = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';

export interface OneDriveOptions {
  /** Returns the token. It may refresh the token first, so it is called for every request. */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
}

interface ItemInfo {
  eTag: string;
  downloadUrl: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

const retryAfterOf = (response: Response): number | undefined => {
  const header = response.headers.get('retry-after');
  return header !== null && Number.isFinite(Number(header)) ? Number(header) : undefined;
};

/**
 * Keeps the files of an app in the OneDrive of the player, in the app folder under `Apps`. It
 * needs only the `Files.ReadWrite.AppFolder` scope, so it sees no other file. The app folder
 * exists for personal Microsoft accounts.
 *
 * A write sends the `eTag` that was read in an `If-Match` header, and a new file is created with
 * `conflictBehavior=fail`. OneDrive answers 412 and 409 when the file changed or exists.
 */
export class OneDriveProvider implements SyncProvider {
  private readonly send: typeof fetch;

  constructor(private readonly options: OneDriveOptions) {
    this.send = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async read(path: string): Promise<RemoteFile | null> {
    const info = await this.info(path);
    if (info === null) return null;
    const content = await this.fetchContent(info.downloadUrl);
    return content === null ? null : { content, version: info.eTag };
  }

  async write(
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }> {
    const url =
      expectedVersion === null
        ? `${this.itemUrl(path)}:/content?@microsoft.graph.conflictBehavior=fail`
        : `${this.itemUrl(path)}:/content`;
    const response = await this.request(
      'PUT',
      url,
      { 'Content-Type': 'text/plain', ...this.ifMatch(expectedVersion) },
      content,
    );
    const expectedFileIsGone = expectedVersion !== null && response.status === 404;
    if (response.status === 412 || response.status === 409 || expectedFileIsGone) {
      throw new VersionConflictError(path);
    }
    await this.assertOk(response);
    const result: unknown = await response.json().catch(() => null);
    if (expectedVersion !== null && response.status === 201) {
      await this.undoCreate(path, result);
      throw new VersionConflictError(path);
    }
    if (!isRecord(result) || typeof result.eTag !== 'string') {
      throw this.invalid('The write returned no version.');
    }
    return { version: result.eTag };
  }

  async remove(path: string, expectedVersion: string): Promise<void> {
    const response = await this.request(
      'DELETE',
      this.itemUrl(path),
      this.ifMatch(expectedVersion),
    );
    if (response.status === 404) return;
    if (response.status === 412) throw new VersionConflictError(path);
    await this.assertOk(response);
  }

  /**
   * OneDrive creates the file when a write with `If-Match` finds none, which would undo the
   * removal that another device made. The file that was just created is removed again.
   */
  private async undoCreate(path: string, created: unknown): Promise<void> {
    if (!isRecord(created) || typeof created.eTag !== 'string') return;
    try {
      await this.remove(path, created.eTag);
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error;
    }
  }

  private itemUrl(path: string): string {
    return `${APP_FOLDER}:/${encodePath(path)}`;
  }

  private ifMatch(version: string | null): Record<string, string> {
    return version === null ? {} : { 'If-Match': version };
  }

  private async info(path: string): Promise<ItemInfo | null> {
    const response = await this.request('GET', this.itemUrl(path));
    if (response.status === 404) return null;
    await this.assertOk(response);
    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body) || typeof body.eTag !== 'string') {
      throw this.invalid('The file has no version.');
    }
    const url = body['@microsoft.graph.downloadUrl'];
    if (typeof url !== 'string') throw this.invalid('The file has no download address.');
    return { eTag: body.eTag, downloadUrl: url };
  }

  /** The download address is signed, so it must not carry the token. */
  private async fetchContent(url: string): Promise<string | null> {
    let response: Response;
    try {
      response = await this.send(url);
    } catch {
      throw new ProviderError('network', 'OneDrive could not be reached.');
    }
    if (response.status === 404) return null;
    await this.assertOk(response);
    return response.text();
  }

  private async request(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<Response> {
    const token = await this.options.getToken();
    try {
      return await this.send(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
    } catch {
      throw new ProviderError('network', 'OneDrive could not be reached.');
    }
  }

  private async assertOk(response: Response): Promise<void> {
    if (response.ok) return;
    const { status } = response;
    const detail = await detailOf(response);
    if (status === 401) {
      throw new ProviderError('auth', 'The token is not valid.', status, undefined, detail);
    }
    if (status === 403) {
      throw new ProviderError(
        'auth',
        'The token has no permission for OneDrive.',
        status,
        undefined,
        detail,
      );
    }
    if (status === 429 || (status === 503 && retryAfterOf(response) !== undefined)) {
      throw new ProviderError(
        'rate-limit',
        'OneDrive limits the calls.',
        status,
        retryAfterOf(response),
        detail,
      );
    }
    if (status === 404) {
      throw new ProviderError(
        'not-found',
        'The app folder was not found.',
        status,
        undefined,
        detail,
      );
    }
    if (status >= 500) {
      throw new ProviderError('server', 'OneDrive failed.', status, undefined, detail);
    }
    throw this.invalid(`OneDrive answered ${status}.`, status, detail);
  }

  private invalid(message: string, status?: number, detail?: string): ProviderError {
    return new ProviderError('invalid', message, status, undefined, detail);
  }
}
