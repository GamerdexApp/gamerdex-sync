import { encodeBase64 } from '@/provider/base64';

interface Stored {
  content: string;
  sha: string;
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

export interface Override {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A small stand in for the GitHub contents API. It follows the status codes that GitHub uses. */
export const createFakeGitHub = (options: { token?: string; repository?: string } = {}) => {
  const token = options.token ?? 'token-1';
  const repository = options.repository ?? 'owner/data';
  const files = new Map<string, Stored>();
  const requests: Recorded[] = [];
  const large = new Set<string>();
  let counter = 0;
  let override: Override | null = null;
  let offline = false;
  let repo: Record<string, unknown> = {
    private: true,
    permissions: { push: true },
    default_branch: 'main',
  };

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  const wrap = (content: string) => (encodeBase64(content).match(/.{1,60}/g) ?? []).join('\n');

  const handle = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method: String(init.method), url, headers, body });
    if (offline) throw new TypeError('Failed to fetch');
    if (override) {
      const next = override;
      override = null;
      return json(next.status, next.body ?? {}, next.headers);
    }
    if (headers.Authorization !== `Bearer ${token}`)
      return json(401, { message: 'Bad credentials' });
    const parsed = new URL(url);
    const prefix = `/repos/${repository}`;
    if (parsed.pathname === prefix) return json(200, repo);
    const path = decodeURIComponent(parsed.pathname.slice(`${prefix}/contents/`.length));
    const stored = files.get(path);
    switch (init.method) {
      case 'GET': {
        if (!stored) return json(404, { message: 'Not Found' });
        if (headers.Accept === 'application/vnd.github.raw+json')
          return new Response(stored.content);
        if (large.has(path)) return json(200, { sha: stored.sha, content: '', encoding: 'none' });
        return json(200, { sha: stored.sha, content: wrap(stored.content), encoding: 'base64' });
      }
      case 'PUT': {
        if (stored && body?.sha === undefined)
          return json(422, { message: 'sha was not supplied' });
        if (stored && body?.sha !== stored.sha) return json(409, { message: 'does not match' });
        counter += 1;
        const sha = `sha${counter}`;
        const content = Buffer.from(String(body?.content), 'base64').toString('utf8');
        files.set(path, { content, sha });
        return json(stored ? 200 : 201, { content: { sha } });
      }
      default: {
        if (!stored) return json(404, { message: 'Not Found' });
        if (body?.sha !== stored.sha) return json(409, { message: 'does not match' });
        files.delete(path);
        return json(200, {});
      }
    }
  };

  return {
    fetch: handle as unknown as typeof fetch,
    token,
    files,
    requests,
    markLarge: (path: string) => large.add(path),
    failNext: (next: Override) => {
      override = next;
    },
    goOffline: () => {
      offline = true;
    },
    setRepository: (next: Record<string, unknown>) => {
      repo = next;
    },
    put: (path: string, content: string) => {
      counter += 1;
      files.set(path, { content, sha: `sha${counter}` });
      return `sha${counter}`;
    },
  };
};
