interface Item {
  id: string;
  name: string;
  parent: string;
  folder: boolean;
  createdTime: string;
  trashed: boolean;
  revisions: { id: string; content: string }[];
}

export interface DriveOverride {
  status: number;
  headers?: Record<string, string>;
  body?: unknown | (() => unknown);
  raw?: string;
}

/**
 * A small stand in for the Google Drive API that behaves like the real one in the ways that matter
 * here: no conditional writes, one revision for each upload with different content, and revisions
 * that can be listed and read.
 */
export const createFakeDrive = () => {
  const token = 'drive-token';
  const items = new Map<string, Item>();
  const requests: { method: string; url: string }[] = [];
  let counter = 0;
  let override: { when: (url: string) => boolean; value: DriveOverride } | null = null;
  let offline = false;

  const hooks = {
    beforeFolderCreate: null as null | ((parent: string, name: string) => void),
    beforeFileCreate: null as null | ((parent: string, name: string) => void),
    beforeUpload: null as null | ((item: Item) => void),
  };
  const options = {
    sameContentMakesRevision: true,
    hideRevisions: 'none' as 'none' | 'head' | 'all-but-head',
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const nextTime = () => new Date(Date.UTC(2026, 0, 1, 0, 0, (counter += 1))).toISOString();

  const add = (
    name: string,
    parent: string,
    folder: boolean,
    content?: string,
    time = nextTime(),
  ) => {
    const id = `id${(counter += 1)}`;
    const item: Item = {
      id,
      name,
      parent,
      folder,
      createdTime: time,
      trashed: false,
      revisions: content === undefined ? [] : [{ id: `rev${(counter += 1)}`, content }],
    };
    items.set(id, item);
    return item;
  };

  const upload = (item: Item, content: string) => {
    const head = item.revisions[item.revisions.length - 1];
    if (head && head.content === content && !options.sameContentMakesRevision) return head.id;
    const revision = { id: `rev${(counter += 1)}`, content };
    item.revisions.push(revision);
    return revision.id;
  };

  const parseQuery = (q: string) => {
    const name = /name = '((?:\\.|[^'\\])*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1') ?? '';
    const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? '';
    const folder = q.includes("mimeType = 'application/vnd.google-apps.folder'");
    return { name, parent, folder };
  };

  const handle = async (url: string, init: RequestInit): Promise<Response> => {
    const method = String(init.method);
    requests.push({ method, url });
    if (offline) throw new TypeError('Failed to fetch');
    if (override?.when(url)) {
      const { value } = override;
      override = null;
      if (value.raw !== undefined)
        return new Response(value.raw, { status: value.status, headers: value.headers });
      const body = typeof value.body === 'function' ? (value.body as () => unknown)() : value.body;
      return new Response(JSON.stringify(body ?? {}), {
        status: value.status,
        headers: value.headers,
      });
    }
    const headers = init.headers as Record<string, string>;
    if (headers.Authorization !== `Bearer ${token}`)
      return json(401, { error: { message: 'Invalid Credentials' } });

    const parsed = new URL(url);
    const path = parsed.pathname;
    const body = typeof init.body === 'string' ? init.body : '';

    if (method === 'GET' && path === '/drive/v3/files') {
      const { name, parent, folder } = parseQuery(parsed.searchParams.get('q') ?? '');
      const files = [...items.values()]
        .filter((i) => i.name === name && i.parent === parent && i.folder === folder && !i.trashed)
        .map((i) => ({ id: i.id, createdTime: i.createdTime }));
      return json(200, { files });
    }
    if (method === 'POST' && path === '/drive/v3/files') {
      const meta = JSON.parse(body) as { name: string; parents: string[] };
      hooks.beforeFolderCreate?.(meta.parents[0], meta.name);
      return json(200, { id: add(meta.name, meta.parents[0], true).id });
    }
    if (method === 'POST' && path === '/upload/drive/v3/files') {
      const boundary = /boundary=(.+)$/.exec(headers['Content-Type'])?.[1] ?? '';
      const parts = body.split(`--${boundary}`).filter((p) => p.trim() !== '' && p.trim() !== '--');
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].replace(/\r\n$/, '')) as {
        name: string;
        parents: string[];
      };
      const content = parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, '');
      hooks.beforeFileCreate?.(meta.parents[0], meta.name);
      const item = add(meta.name, meta.parents[0], false, content);
      return json(200, { id: item.id, headRevisionId: item.revisions[0].id });
    }
    const upload1 = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (method === 'PATCH' && upload1) {
      const item = items.get(upload1[1]);
      if (!item) return json(404, { error: { message: 'File not found' } });
      hooks.beforeUpload?.(item);
      return json(200, { headRevisionId: upload(item, body) });
    }
    const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (file) {
      const item = items.get(file[1]);
      if (!item) return json(404, { error: { message: 'File not found' } });
      if (method === 'DELETE') {
        items.delete(item.id);
        return new Response(null, { status: 204 });
      }
      const head = item.revisions[item.revisions.length - 1];
      return json(200, { headRevisionId: head?.id, trashed: item.trashed });
    }
    const revisions = /^\/drive\/v3\/files\/([^/]+)\/revisions$/.exec(path);
    if (revisions) {
      const item = items.get(revisions[1]);
      if (!item) return json(404, { error: { message: 'File not found' } });
      const all = item.revisions.map((r) => ({ id: r.id }));
      if (options.hideRevisions === 'head') return json(200, { revisions: all.slice(0, -1) });
      if (options.hideRevisions === 'all-but-head') return json(200, { revisions: all.slice(-1) });
      return json(200, { revisions: all });
    }
    const revision = /^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/.exec(path);
    if (revision) {
      const found = items.get(revision[1])?.revisions.find((r) => r.id === revision[2]);
      return found
        ? new Response(found.content)
        : json(404, { error: { message: 'Revision not found' } });
    }
    return json(404, { error: { message: 'No route' } });
  };

  const find = (name: string) => [...items.values()].find((i) => i.name === name && !i.folder);

  return {
    fetch: handle as unknown as typeof fetch,
    token,
    items,
    requests,
    hooks,
    options,
    seedFolder: (name: string, parent: string, time?: string) =>
      add(name, parent, true, undefined, time),
    seedFile: (name: string, parent: string, content: string, time?: string) =>
      add(name, parent, false, content, time),
    upload: (item: Item, content: string) => upload(item, content),
    fileNamed: (name: string) => find(name),
    contentOf: (name: string) => {
      const item = find(name);
      return item?.revisions[item.revisions.length - 1]?.content;
    },
    failWhen: (when: (url: string) => boolean, value: DriveOverride) => {
      override = { when, value };
    },
    failNext: (value: DriveOverride) => {
      override = { when: () => true, value };
    },
    goOffline: () => {
      offline = true;
    },
  };
};
