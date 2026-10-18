import { detailOf } from './detail';
import { ProviderError, RemoteFile, SyncProvider, VersionConflictError } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'];

export interface GoogleDriveOptions {
  /** Returns the token. It may refresh the token first, so it is called for every request. */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
}

interface DriveItem {
  id: string;
  createdTime: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const quoted = (value: string): string => `'${value.replace(/[\\']/g, '\\$&')}'`;

const oldestFirst = (a: DriveItem, b: DriveItem): number =>
  a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id);

const reasonOf = (body: unknown): string | undefined => {
  if (!isRecord(body) || !isRecord(body.error) || !Array.isArray(body.error.errors))
    return undefined;
  const first: unknown = body.error.errors[0];
  return isRecord(first) && typeof first.reason === 'string' ? first.reason : undefined;
};

/**
 * Keeps the files of an app in the Google Drive of the player, in a visible `Gamerdex` folder. It
 * needs only the `drive.file` scope, which sees the files that this app created.
 *
 * Drive cannot refuse a write made from an old version. Writes are checked in two steps instead:
 * the head revision must equal the expected version before the upload, and the revision list must
 * show the new revision directly on top of the expected one after it. When another device wrote in
 * between, its content is written back as the head and `VersionConflictError` is thrown, so the
 * next sync merges both sides.
 */
export class GoogleDriveProvider implements SyncProvider {
  private readonly send: typeof fetch;
  private readonly folders = new Map<string, string>();

  constructor(private readonly options: GoogleDriveOptions) {
    this.send = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async read(path: string): Promise<RemoteFile | null> {
    const file = await this.findFile(path);
    if (!file) return null;
    const head = await this.headOf(file.id);
    if (head === null) return null;
    return { content: await this.revisionContent(file.id, head), version: head };
  }

  async write(
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }> {
    if (expectedVersion === null) return this.create(path, content);

    const file = await this.findFile(path);
    if (!file || (await this.headOf(file.id)) !== expectedVersion) {
      throw new VersionConflictError(path);
    }
    const version = await this.upload(file.id, content);
    if (version === expectedVersion) return { version };

    const previous = await this.revisionBefore(file.id, version);
    if (previous === expectedVersion) return { version };

    await this.upload(file.id, await this.revisionContent(file.id, previous));
    throw new VersionConflictError(path);
  }

  async remove(path: string, expectedVersion: string): Promise<void> {
    const file = await this.findFile(path);
    if (!file) return;
    if ((await this.headOf(file.id)) !== expectedVersion) throw new VersionConflictError(path);
    await this.deleteItem(file.id);
  }

  private async create(path: string, content: string): Promise<{ version: string }> {
    const { parentId, name } = await this.locate(path, true);
    if ((await this.children(parentId, name)).length > 0) throw new VersionConflictError(path);

    const created = await this.createFile(parentId, name, content);
    const [oldest] = await this.children(parentId, name);
    if (oldest.id !== created.id) {
      await this.deleteItem(created.id);
      throw new VersionConflictError(path);
    }
    return { version: created.version };
  }

  private async findFile(path: string): Promise<DriveItem | null> {
    const located = await this.locate(path, false);
    if (!located) return null;
    return (await this.children(located.parentId, located.name))[0] ?? null;
  }

  private async locate(path: string, create: true): Promise<{ parentId: string; name: string }>;
  private async locate(
    path: string,
    create: false,
  ): Promise<{ parentId: string; name: string } | null>;
  private async locate(path: string, create: boolean) {
    const parts = path.split('/');
    const name = parts.pop() as string;
    let parentId = 'root';
    let walked = '';
    for (const folder of parts) {
      walked += `/${folder}`;
      const known = this.folders.get(walked);
      if (known) {
        parentId = known;
        continue;
      }
      const id = await this.folderId(parentId, folder, create);
      if (id === null) return null;
      this.folders.set(walked, id);
      parentId = id;
    }
    return { parentId, name };
  }

  private async folderId(parentId: string, name: string, create: boolean): Promise<string | null> {
    const found = await this.children(parentId, name, true);
    if (found.length > 0) return found[0].id;
    if (!create) return null;

    const response = await this.request('POST', `${API}/files?fields=id`, {
      body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parentId] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const id = this.stringField(await response.json(), 'id');
    const [oldest] = await this.children(parentId, name, true);
    if (oldest.id !== id) {
      await this.deleteItem(id);
      return oldest.id;
    }
    return id;
  }

  private async children(parentId: string, name: string, folder = false): Promise<DriveItem[]> {
    const query = [
      `name = ${quoted(name)}`,
      `${quoted(parentId)} in parents`,
      'trashed = false',
      `mimeType ${folder ? '=' : '!='} '${FOLDER_TYPE}'`,
    ].join(' and ');
    const url = `${API}/files?${new URLSearchParams({
      q: query,
      fields: 'files(id,createdTime)',
      pageSize: '100',
    })}`;
    const body: unknown = await (await this.request('GET', url)).json();
    const files = isRecord(body) && Array.isArray(body.files) ? body.files : [];
    return files
      .filter(
        (item): item is DriveItem =>
          isRecord(item) && typeof item.id === 'string' && typeof item.createdTime === 'string',
      )
      .sort(oldestFirst);
  }

  private async headOf(id: string): Promise<string | null> {
    const response = await this.request(
      'GET',
      `${API}/files/${encodeURIComponent(id)}?fields=headRevisionId,trashed`,
      { allowMissing: true },
    );
    if (response.status === 404) return null;
    const body: unknown = await response.json();
    if (isRecord(body) && body.trashed === true) return null;
    return this.stringField(body, 'headRevisionId');
  }

  private async revisionContent(id: string, revision: string): Promise<string> {
    const url = `${API}/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}?alt=media`;
    return (await this.request('GET', url)).text();
  }

  private async revisionBefore(id: string, revision: string): Promise<string> {
    const url = `${API}/files/${encodeURIComponent(id)}/revisions?${new URLSearchParams({
      fields: 'revisions(id)',
      pageSize: '1000',
    })}`;
    const body: unknown = await (await this.request('GET', url)).json();
    const revisions = (isRecord(body) && Array.isArray(body.revisions) ? body.revisions : [])
      .filter(isRecord)
      .map((item) => item.id);
    const index = revisions.indexOf(revision);
    const previous = revisions[index - 1];
    if (index < 1 || typeof previous !== 'string') {
      throw new ProviderError('server', 'The new revision is not in the revision list.');
    }
    return previous;
  }

  private async upload(id: string, content: string): Promise<string> {
    const url = `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=headRevisionId`;
    const response = await this.request('PATCH', url, {
      body: content,
      headers: { 'Content-Type': 'application/json' },
    });
    return this.stringField(await response.json(), 'headRevisionId');
  }

  private async createFile(
    parentId: string,
    name: string,
    content: string,
  ): Promise<{ id: string; version: string }> {
    const boundary = `gamerdex-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const response = await this.request(
      'POST',
      `${UPLOAD}/files?uploadType=multipart&fields=id,headRevisionId`,
      { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } },
    );
    const answer: unknown = await response.json();
    return {
      id: this.stringField(answer, 'id'),
      version: this.stringField(answer, 'headRevisionId'),
    };
  }

  private async deleteItem(id: string): Promise<void> {
    await this.request('DELETE', `${API}/files/${encodeURIComponent(id)}`, { allowMissing: true });
  }

  private stringField(body: unknown, field: string): string {
    const value = isRecord(body) ? body[field] : undefined;
    if (typeof value !== 'string') {
      throw new ProviderError('invalid', `Google Drive answered without ${field}.`);
    }
    return value;
  }

  private async request(
    method: string,
    url: string,
    options: { body?: string; headers?: Record<string, string>; allowMissing?: boolean } = {},
  ): Promise<Response> {
    const token = await this.options.getToken();
    let response: Response;
    try {
      response = await this.send(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
        body: options.body,
      });
    } catch {
      throw new ProviderError('network', 'Google Drive could not be reached.');
    }
    if (response.ok || (options.allowMissing && response.status === 404)) return response;
    throw await this.failure(response);
  }

  private async failure(response: Response): Promise<ProviderError> {
    const { status } = response;
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const detail = await detailOf(response);
    if (status === 401) {
      return new ProviderError('auth', 'The token is not valid.', status, undefined, detail);
    }
    const reason = reasonOf(body);
    if (status === 429 || (status === 403 && reason && RATE_LIMIT_REASONS.includes(reason))) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return new ProviderError(
        'rate-limit',
        'Google Drive limits the calls.',
        status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        detail,
      );
    }
    if (status === 403) {
      return new ProviderError(
        'auth',
        'The token has no permission for Drive.',
        status,
        undefined,
        detail,
      );
    }
    if (status === 404) {
      return new ProviderError(
        'not-found',
        'The file or folder was not found.',
        status,
        undefined,
        detail,
      );
    }
    if (status >= 500) {
      return new ProviderError('server', 'Google Drive failed.', status, undefined, detail);
    }
    return new ProviderError(
      'invalid',
      `Google Drive answered ${status}.`,
      status,
      undefined,
      detail,
    );
  }
}
