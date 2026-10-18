// Runs the built DropboxProvider or OneDriveProvider against the real API.
// Usage: pnpm build && PROVIDER=dropbox TOKEN='sl.u...' node scripts/live-provider-check.mjs
//        pnpm build && PROVIDER=onedrive TOKEN='EwB...' node scripts/live-provider-check.mjs
// The token needs only the app folder access (Dropbox App folder with files.content.read and
// files.content.write, or OneDrive Files.ReadWrite.AppFolder). The script creates test folders in
// the app folder of the token owner and removes them at the end. It never prints the token.
import { DropboxProvider, OneDriveProvider, ProviderError, sync, VersionConflictError } from '../dist/index.mjs';

const kind = process.env.PROVIDER;
const token = process.env.TOKEN;
if (!['dropbox', 'onedrive'].includes(kind) || !token) {
  console.error('Set PROVIDER to dropbox or onedrive, and set TOKEN.');
  process.exit(1);
}

const STAMP = Date.now();
const ROOT = `gamerdex-live-test-${STAMP}`;
const APP_ID = `live-test-${STAMP}`;
const REQUEST_TIMEOUT_MS = 20000;
const timedFetch = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
process.on('unhandledRejection', (error) => {
  console.log(`CRASH  ${error?.message ?? error}`);
  process.exit(1);
});

const provider = () =>
  new (kind === 'dropbox' ? DropboxProvider : OneDriveProvider)({ getToken: async () => token, fetch: timedFetch });

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
const outcome = async (promise) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof VersionConflictError) return 'conflict';
    return `error:${error instanceof ProviderError ? `${error.kind} ${error.status} ${error.detail ?? ''}` : error.message}`;
  }
};

const p = provider();
const PATH = `${ROOT}/data.json`;

await check('read of a missing file returns null', async () => {
  assert((await p.read(PATH)) === null, 'expected null');
});

let v1;
await check('create makes the file and its folders and returns a version', async () => {
  const result = await p.write(PATH, '{"n":1}', null);
  assert(typeof result.version === 'string' && result.version !== '', 'no version');
  v1 = result.version;
});

await check('read returns the content and the same version', async () => {
  const read = await p.read(PATH);
  assert(read?.content === '{"n":1}', `content was ${read?.content}`);
  assert(read.version === v1, `version ${read.version} is not ${v1}`);
});

await check('creating a file that exists is a version conflict', async () => {
  assert((await outcome(p.write(PATH, '{"n":99}', null))) === 'conflict', 'no conflict');
  assert((await p.read(PATH)).content === '{"n":1}', 'content changed');
});

let v2;
await check('update with the current version succeeds and changes the version', async () => {
  v2 = (await p.write(PATH, '{"n":2}', v1)).version;
  assert(v2 !== v1, 'version did not change');
  assert((await p.read(PATH)).content === '{"n":2}', 'content not updated');
});

await check('update with an old version is a version conflict and keeps the content', async () => {
  assert((await outcome(p.write(PATH, '{"n":3}', v1))) === 'conflict', 'no conflict');
  assert((await p.read(PATH)).content === '{"n":2}', 'content changed');
});

await check('two parallel updates from one version: exactly one wins', async () => {
  const base = (await p.read(PATH)).version;
  const [a, b] = await Promise.all([outcome(p.write(PATH, '{"w":"a"}', base)), outcome(p.write(PATH, '{"w":"b"}', base))]);
  assert([a, b].filter((x) => x === 'ok').length === 1, `outcomes ${a} and ${b}`);
  assert([a, b].filter((x) => x === 'conflict').length === 1, `outcomes ${a} and ${b}`);
  const winner = a === 'ok' ? '{"w":"a"}' : '{"w":"b"}';
  assert((await p.read(PATH)).content === winner, 'content is not the winner');
  return `${a} and ${b}`;
});

await check('two parallel creates of one new file: exactly one wins', async () => {
  const path = `${ROOT}/race.json`;
  const [a, b] = await Promise.all([outcome(p.write(path, '{"w":"a"}', null)), outcome(p.write(path, '{"w":"b"}', null))]);
  assert([a, b].filter((x) => x === 'ok').length === 1, `outcomes ${a} and ${b}`);
  assert([a, b].filter((x) => x === 'conflict').length === 1, `outcomes ${a} and ${b}`);
  return `${a} and ${b}`;
});

await check('removing with an old version is a version conflict and keeps the file', async () => {
  assert((await outcome(p.remove(PATH, v1))) === 'conflict', 'no conflict');
  assert((await p.read(PATH)) !== null, 'file is gone');
});

await check('a write that expects a removed file is a version conflict and creates nothing', async () => {
  const path = `${ROOT}/gone.json`;
  const { version } = await p.write(path, '{"g":1}', null);
  await p.remove(path, version);
  const result = await outcome(p.write(path, '{"g":2}', version));
  const exists = (await p.read(path)) !== null;
  assert(result === 'conflict', `outcome ${result}`);
  assert(!exists, 'the write created the file again');
});

await check('removing with the current version removes the file, and removing again is fine', async () => {
  const current = (await p.read(PATH)).version;
  await p.remove(PATH, current);
  assert((await p.read(PATH)) === null, 'file still there');
  await p.remove(PATH, current);
});

await check('a path and content with characters outside ASCII round trip', async () => {
  const path = `${ROOT}/café ünï/data.json`;
  const content = JSON.stringify({ name: 'Ünï 🙂 日本語' });
  const { version } = await p.write(path, content, null);
  const read = await p.read(path);
  assert(read?.content === content, `content was ${read?.content}`);
  assert(read.version === version, 'version differs');
});

await check('sync() merges two devices on the real service and an idle sync writes nothing', async () => {
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
  const idle = await a.run();
  assert(idle.uploaded === false, 'an idle sync uploaded');
});

console.log('\nCleaning up');
const cleanup = async (name) => {
  const response =
    kind === 'dropbox'
      ? await timedFetch('https://api.dropboxapi.com/2/files/delete_v2', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `/${name}` }),
        })
      : await timedFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
  console.log(`  removed ${name}: HTTP ${response.status}`);
};
await cleanup(ROOT);
await cleanup('Gamerdex/' + APP_ID);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.map((r) => r.name).join('; ')}`);
  process.exit(1);
}
