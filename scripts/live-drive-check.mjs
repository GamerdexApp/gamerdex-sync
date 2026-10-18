// Runs the built GoogleDriveProvider against the real Google Drive API.
// Usage: pnpm build && GDRIVE_TOKEN='ya29...' node scripts/live-drive-check.mjs
// The token needs only the drive.file scope. The script creates test folders in the Drive of the
// token owner and removes them at the end. It never prints the token.
import { GoogleDriveProvider, ProviderError, sync, VersionConflictError } from '../dist/index.mjs';

const token = process.env.GDRIVE_TOKEN;
if (!token) {
  console.error('Set GDRIVE_TOKEN first.');
  process.exit(1);
}

const STAMP = Date.now();
const ROOT = `gamerdex-live-test-${STAMP}`;
const APP_ID = `live-test-${STAMP}`;
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

const REQUEST_TIMEOUT_MS = 20000;
const timedFetch = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
process.on('unhandledRejection', (error) => {
  console.log(`CRASH  ${error?.message ?? error}`);
  process.exit(1);
});

const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const check = async (name, run) => {
  const started = Date.now();
  console.log(`RUN   ${name}`);
  try {
    const note = (await run()) ?? '';
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${note ? `  (${note})` : ''}  [${Date.now() - started} ms]`);
  } catch (error) {
    results.push({ name, ok: false });
    const detail = error instanceof ProviderError ? ` [${error.kind} ${error.status ?? ''} ${error.detail ?? ''}]` : '';
    console.log(`FAIL  ${name}  ${error.message}${detail}`);
  }
};

const raw = async (method, url, body, headers = {}) => {
  const response = await timedFetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
};
const quoted = (value) => `'${value.replace(/[\\']/g, '\\$&')}'`;
const find = async (name, parentId, folder) => {
  const q = [`name = ${quoted(name)}`, 'trashed = false', `mimeType ${folder ? '=' : '!='} '${FOLDER}'`];
  if (parentId) q.push(`${quoted(parentId)} in parents`);
  const url = `${API}/files?${new URLSearchParams({ q: q.join(' and '), fields: 'files(id,name,mimeType,createdTime,parents)', pageSize: '100' })}`;
  return (await raw('GET', url)).json?.files ?? [];
};
const headRevision = async (id) => (await raw('GET', `${API}/files/${id}?fields=headRevisionId`)).json?.headRevisionId;
const revisionCount = async (id) => (await raw('GET', `${API}/files/${id}/revisions?fields=revisions(id)&pageSize=1000`)).json?.revisions?.length;
const provider = (extra = {}) => new GoogleDriveProvider({ getToken: async () => token, fetch: timedFetch, ...extra });
const rejectsWith = async (promise, type) => {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof type, `expected ${type.name}, got ${error?.constructor?.name}: ${error?.message}`);
    return;
  }
  throw new Error(`expected ${type.name}, but it succeeded`);
};

const P = `${ROOT}/app/data.json`;
let first = null;

const tokenCheck = await raw('GET', `${API}/files?pageSize=1&fields=files(id)`);
if (tokenCheck.status !== 200) {
  console.error(`The token was refused (HTTP ${tokenCheck.status}). Get a fresh token and try again.`);
  process.exit(1);
}
console.log(`Live Drive check, test folder: ${ROOT}\n`);

const stale = (
  await raw('GET', `${API}/files?${new URLSearchParams({ q: `name contains 'gamerdex-live-test-' and mimeType = '${FOLDER}' and trashed = false`, fields: 'files(id,name)', pageSize: '100' })}`)
).json?.files ?? [];
for (const folder of stale) {
  console.log(`Removing a folder left by an earlier run: ${folder.name} (HTTP ${(await raw('DELETE', `${API}/files/${folder.id}`)).status})`);
}


await check('read of a missing path returns null', async () => {
  assert((await provider().read(P)) === null, 'expected null');
});

await check('create makes visible folders and one JSON file', async () => {
  first = await provider().write(P, '{"n":1}', null);
  const roots = await find(ROOT, null, true);
  assert(roots.length === 1, `expected 1 root folder, found ${roots.length}`);
  const apps = await find('app', roots[0].id, true);
  assert(apps.length === 1, `expected 1 app folder, found ${apps.length}`);
  const files = await find('data.json', apps[0].id, false);
  assert(files.length === 1, `expected 1 file, found ${files.length}`);
  assert(files[0].mimeType === 'application/json', `mime type is ${files[0].mimeType}`);
});

await check('read returns the content and the real head revision as the version', async () => {
  const read = await provider().read(P);
  const file = (await find('data.json', (await find('app', (await find(ROOT, null, true))[0].id, true))[0].id, false))[0];
  assert(read?.content === '{"n":1}', `content was ${read?.content}`);
  assert(read.version === first.version, 'version differs from the create answer');
  assert(read.version === (await headRevision(file.id)), 'version is not the head revision of Drive');
});

await check('accents, Chinese and emoji survive a round trip', async () => {
  const text = '{"s":"Ünï 🙂 中文"}';
  const p = provider();
  await p.write(`${ROOT}/app/unicode.json`, text, null);
  assert((await p.read(`${ROOT}/app/unicode.json`))?.content === text, 'content changed');
});

await check('create refuses a file that already exists', async () => {
  await rejectsWith(provider().write(P, '{"n":9}', null), VersionConflictError);
});

await check('update works from the read version and a stale version is refused', async () => {
  const p = provider();
  const v1 = (await p.read(P)).version;
  const v2 = (await p.write(P, '{"n":2}', v1)).version;
  assert(v1 !== v2, 'version did not change');
  await rejectsWith(p.write(P, '{"n":3}', v1), VersionConflictError);
  assert((await p.read(P)).content === '{"n":2}', 'a refused write changed the file');
});

await check('ten updates in a row all pass the revision check', async () => {
  const p = provider();
  let failures = 0;
  const spent = [];
  for (let i = 0; i < 10; i += 1) {
    const { version } = await p.read(P);
    const started = Date.now();
    try {
      await p.write(P, JSON.stringify({ round: i }), version);
    } catch (error) {
      failures += 1;
      console.log(`      update ${i}: ${error.message}`);
    }
    spent.push(Date.now() - started);
  }
  assert(failures === 0, `${failures} of 10 updates failed`);
  return `average ${Math.round(spent.reduce((a, b) => a + b, 0) / spent.length)} ms`;
});

await check('a write that collides during the upload is repaired and reported', async () => {
  const dataFile = (await find('data.json', (await find('app', (await find(ROOT, null, true))[0].id, true))[0].id, false))[0];
  const before = await revisionCount(dataFile.id);
  let injected = false;
  const racing = async (url, init) => {
    if (!injected && init?.method === 'PATCH' && String(url).includes('/upload/drive/v3/files/')) {
      injected = true;
      await raw('PATCH', `${UPLOAD}/files/${dataFile.id}?uploadType=media&fields=headRevisionId`, '{"by":"other device"}', { 'Content-Type': 'application/json' });
    }
    return timedFetch(url, init);
  };
  const a = provider({ fetch: racing });
  const { version } = await provider().read(P);
  await rejectsWith(a.write(P, '{"by":"me"}', version), VersionConflictError);
  assert(injected, 'the collision was never injected');
  const after = await provider().read(P);
  assert(after.content === '{"by":"other device"}', `head holds ${after.content}, not the other device`);
  await provider().write(P, '{"by":"merged"}', after.version);
  const revisions = await revisionCount(dataFile.id);
  return `revisions ${before} -> ${revisions}`;
});

await check('two devices creating the same new file at once: exactly one wins (5 rounds)', async () => {
  const problems = [];
  for (let i = 0; i < 5; i += 1) {
    const path = `${ROOT}/race${i}/data.json`;
    const [one, two] = await Promise.allSettled([provider().write(path, '{"by":"a"}', null), provider().write(path, '{"by":"b"}', null)]);
    const wins = [one, two].filter((r) => r.status === 'fulfilled').length;
    const loses = [one, two].filter((r) => r.status === 'rejected' && r.reason instanceof VersionConflictError).length;
    const other = [one, two].filter((r) => r.status === 'rejected' && !(r.reason instanceof VersionConflictError));
    const folders = await find(`race${i}`, (await find(ROOT, null, true))[0].id, true);
    const files = folders[0] ? await find('data.json', folders[0].id, false) : [];
    if (wins !== 1 || loses !== 1 || other.length > 0 || folders.length !== 1 || files.length !== 1) {
      problems.push(`round ${i}: wins=${wins} conflicts=${loses} errors=${other.map((r) => r.reason?.message).join('|')} folders=${folders.length} files=${files.length}`);
    }
  }
  assert(problems.length === 0, problems.join('; '));
});

await check('a trashed file reads as missing and can be created again', async () => {
  const p = provider();
  await p.write(`${ROOT}/trash/data.json`, '{"t":1}', null);
  const folder = (await find('trash', (await find(ROOT, null, true))[0].id, true))[0];
  const file = (await find('data.json', folder.id, false))[0];
  await raw('PATCH', `${API}/files/${file.id}`, JSON.stringify({ trashed: true }), { 'Content-Type': 'application/json' });
  assert((await provider().read(`${ROOT}/trash/data.json`)) === null, 'a trashed file was still read');
  await provider().write(`${ROOT}/trash/data.json`, '{"t":2}', null);
  assert((await provider().read(`${ROOT}/trash/data.json`))?.content === '{"t":2}', 'the new file was not read');
});

await check("a name with an apostrophe works", async () => {
  const p = provider();
  const path = `${ROOT}/it's here/data.json`;
  await p.write(path, '{"q":1}', null);
  assert((await p.read(path))?.content === '{"q":1}', 'content was not read back');
});

await check('sync() merges two devices on real Drive and an idle sync writes nothing', async () => {
  const schema = { type: 'object', each: { type: 'object', each: { type: 'max', order: (value) => Number(value) } } };
  const device = (id, local) => {
    const self = {
      local,
      state: null,
      run: async () => {
        const result = await sync({ appId: APP_ID, deviceId: id, deviceName: id, provider: provider(), schema, local: self.local, state: self.state, now: () => new Date().toISOString() });
        assert(result.status === 'synced', `status was ${result.status}`);
        self.local = result.data;
        self.state = result.state;
        return result;
      },
    };
    return self;
  };
  const a = device('a', { x: { y: 1, z: 1 } });
  await a.run();
  const b = device('b', { x: { y: 1, z: 1 } });
  await b.run();
  a.local = { x: { y: 2, z: 1 } };
  b.local = { x: { y: 1, z: 3 } };
  await a.run();
  await b.run();
  await a.run();
  const want = JSON.stringify({ x: { y: 2, z: 3 } });
  assert(JSON.stringify(a.local) === want && JSON.stringify(b.local) === want, `devices hold ${JSON.stringify(a.local)} and ${JSON.stringify(b.local)}`);
  const gamerdex = (await find('Gamerdex', null, true))[0];
  const app = (await find(APP_ID, gamerdex.id, true))[0];
  const data = (await find('data.json', app.id, false))[0];
  const meta = (await find('meta.json', app.id, false))[0];
  const before = [await revisionCount(data.id), await revisionCount(meta.id)];
  const idle = await a.run();
  const after = [await revisionCount(data.id), await revisionCount(meta.id)];
  assert(idle.uploaded === false, 'an idle sync uploaded');
  assert(before[0] === after[0] && before[1] === after[1], `revisions changed ${before} -> ${after}`);
  return `data revisions ${after[0]}, meta revisions ${after[1]}`;
});

console.log('\nCleaning up');
for (const [name, parent] of [[ROOT, null]]) {
  for (const folder of await find(name, parent, true)) console.log(`  removed ${name}: HTTP ${(await raw('DELETE', `${API}/files/${folder.id}`)).status}`);
}
const gamerdexFolder = (await find('Gamerdex', null, true))[0];
if (gamerdexFolder) {
  for (const folder of await find(APP_ID, gamerdexFolder.id, true)) console.log(`  removed ${APP_ID}: HTTP ${(await raw('DELETE', `${API}/files/${folder.id}`)).status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.map((r) => r.name).join('; ')}`);
  process.exit(1);
}
