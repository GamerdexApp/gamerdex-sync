interface Stored {
  content: string;
  rev: string;
}

export interface Recorded {
  url: string;
  headers: Record<string, string>;
  arg: Record<string, unknown> | undefined;
  body: string | undefined;
}

export interface Override {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  raw?: string;
}

const text = (status: number, raw: string, headers: Record<string, string> = {}) =>
  new Response(raw, { status, headers });

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  text(status, JSON.stringify(body), headers);

const notFound = () =>
  json(409, {
    error_summary: 'path/not_found/.',
    error: { '.tag': 'path', path: { '.tag': 'not_found' } },
  });

const conflict = () =>
  json(409, {
    error_summary: 'path/conflict/file/..',
    error: {
      '.tag': 'path',
      reason: { '.tag': 'conflict', conflict: { '.tag': 'file' } },
      upload_session_id: 'session-1',
    },
  });

/** A small stand in for the Dropbox files API. It follows the status codes that Dropbox uses. */
export const createFakeDropbox = (
  options: { token?: string; deleteMismatch?: 'not_found' | 'conflict' } = {},
) => {
  const token = options.token ?? 'token-1';
  const deleteMismatch = options.deleteMismatch ?? 'not_found';
  const files = new Map<string, Stored>();
  const requests: Recorded[] = [];
  let counter = 0;
  let override: Override | null = null;
  let offline = false;

  const handle = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const argHeader = headers['Dropbox-API-Arg'];
    const body = init.body === undefined ? undefined : String(init.body);
    const arg = (argHeader ? JSON.parse(argHeader) : body ? JSON.parse(body) : undefined) as
      Record<string, unknown> | undefined;
    requests.push({ url, headers, arg, body: argHeader ? body : undefined });
    if (offline) throw new TypeError('Failed to fetch');
    if (override) {
      const next = override;
      override = null;
      if (next.raw !== undefined) return text(next.status, next.raw, next.headers);
      return json(next.status, next.body ?? {}, next.headers);
    }
    if (headers.Authorization !== `Bearer ${token}`) {
      return text(401, 'Error in call to API function: The access token is invalid.');
    }
    const path = String(arg?.path).slice(1);
    const stored = files.get(path);
    const route = new URL(url).pathname;
    if (route === '/2/files/download') {
      if (!stored) return notFound();
      return text(200, stored.content, {
        'dropbox-api-result': JSON.stringify({ rev: stored.rev }),
      });
    }
    if (route === '/2/files/upload') {
      const mode = (arg?.mode as { '.tag': string; update?: string }) ?? { '.tag': 'add' };
      if (mode['.tag'] === 'add' && stored) return conflict();
      if (mode['.tag'] === 'update' && (!stored || stored.rev !== mode.update)) return conflict();
      counter += 1;
      const rev = `rev${counter}`;
      files.set(path, { content: body ?? '', rev });
      return json(200, { rev });
    }
    if (!stored) return notFound();
    if (arg?.parent_rev !== stored.rev) {
      return deleteMismatch === 'conflict'
        ? json(409, {
            error: { '.tag': 'path_write', path_write: { '.tag': 'conflict' } },
          })
        : notFound();
    }
    files.delete(path);
    return json(200, { metadata: {} });
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
      counter += 1;
      files.set(path, { content, rev: `rev${counter}` });
      return `rev${counter}`;
    },
  };
};
