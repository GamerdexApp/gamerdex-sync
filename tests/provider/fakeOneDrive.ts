interface Stored {
  content: string;
  eTag: string;
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface Override {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  raw?: string;
}

const APP_FOLDER = '/v1.0/me/drive/special/approot:/';
const DOWNLOAD_HOST = 'https://download.test/';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const failure = (status: number, code: string) =>
  json(status, { error: { code, message: `${code} message` } });

/**
 * A small stand in for the OneDrive app folder API. It follows the status codes that Graph
 * documents. What an `If-Match` write does to a file that was removed is not documented, so the
 * test chooses the answer.
 */
export const createFakeOneDrive = (
  options: { token?: string; missingWithIfMatch?: 201 | 404 | 412 } = {},
) => {
  const token = options.token ?? 'token-1';
  const missingWithIfMatch = options.missingWithIfMatch ?? 412;
  const files = new Map<string, Stored>();
  const requests: Recorded[] = [];
  let counter = 0;
  let override: Override | null = null;
  let offline = false;

  const nextTag = () => {
    counter += 1;
    return `etag${counter}`;
  };

  const handle = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = String(init.method ?? 'GET');
    requests.push({
      method,
      url,
      headers,
      body: init.body === undefined ? undefined : String(init.body),
    });
    if (offline) throw new TypeError('Failed to fetch');
    if (override) {
      const next = override;
      override = null;
      if (next.raw !== undefined) {
        return new Response(next.raw, { status: next.status, headers: next.headers });
      }
      return json(next.status, next.body ?? {}, next.headers);
    }
    if (url.startsWith(DOWNLOAD_HOST)) {
      const stored = files.get(decodeURIComponent(url.slice(DOWNLOAD_HOST.length)));
      return stored ? new Response(stored.content) : new Response('', { status: 404 });
    }
    if (headers.Authorization !== `Bearer ${token}`)
      return failure(401, 'InvalidAuthenticationToken');
    const parsed = new URL(url);
    const rest = decodeURIComponent(parsed.pathname.slice(APP_FOLDER.length));
    const isContent = rest.endsWith(':/content');
    const path = isContent ? rest.slice(0, -':/content'.length) : rest;
    const stored = files.get(path);
    const ifMatch = headers['If-Match'];

    if (method === 'GET') {
      if (!stored) return failure(404, 'itemNotFound');
      return json(200, {
        eTag: stored.eTag,
        '@microsoft.graph.downloadUrl': `${DOWNLOAD_HOST}${encodeURIComponent(path)}`,
      });
    }
    if (method === 'PUT') {
      const content = String(init.body);
      if (ifMatch !== undefined && !stored) {
        if (missingWithIfMatch === 201) {
          const eTag = nextTag();
          files.set(path, { content, eTag });
          return json(201, { eTag });
        }
        return failure(missingWithIfMatch, 'itemNotFound');
      }
      if (ifMatch !== undefined && stored?.eTag !== ifMatch) {
        return failure(412, 'preconditionFailed');
      }
      if (parsed.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail' && stored) {
        return failure(409, 'nameAlreadyExists');
      }
      const eTag = nextTag();
      files.set(path, { content, eTag });
      return json(stored ? 200 : 201, { eTag });
    }
    if (!stored) return failure(404, 'itemNotFound');
    if (ifMatch !== stored.eTag) return failure(412, 'preconditionFailed');
    files.delete(path);
    return new Response(null, { status: 204 });
  };

  return {
    fetch: handle as unknown as typeof fetch,
    token,
    files,
    requests,
    failNext: (next: Override) => {
      override = next;
    },
    goOffline: () => {
      offline = true;
    },
    put: (path: string, content: string) => {
      const eTag = nextTag();
      files.set(path, { content, eTag });
      return eTag;
    },
  };
};
