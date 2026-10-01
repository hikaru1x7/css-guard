import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { updateDependencies, installedVersions } from '../lib/maintenance.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-maintenance-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [name, version] of Object.entries({ playwright: '1.63.0', pixelmatch: '7.2.0', pngjs: '7.0.0' })) {
    const target = path.join(directory, 'node_modules', name);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ version }));
  }
  return directory;
}

test('更新は範囲付きnpm updateではなくlatest正式版を指定し、ブラウザと試験の成功後だけ記録する', async (t) => {
  const directory = await fixture(t), calls = [];
  const result = await updateDependencies({ directory, run: (...args) => calls.push(args) });
  assert.deepEqual(calls[0][1].slice(-3), ['playwright@latest', 'pixelmatch@latest', 'pngjs@latest']);
  assert.ok(calls[0][1].includes('--engine-strict'));
  assert.equal(calls[1][1].slice(-1)[0], 'chromium');
  assert.deepEqual(calls[2].slice(0, 2), ['npm', ['test']]);
  assert.deepEqual(result.versions, await installedVersions(directory));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, '.guard-maintenance.json'))), result);
});

test('同じ検証済み版でも正式版の再確認とブラウザ起動を行い、重複する全試験は省く', async (t) => {
  const directory = await fixture(t), calls = [];
  await updateDependencies({ directory, run: () => {} });
  await updateDependencies({ directory, run: (...args) => calls.push(args) });
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'npm');
  assert.match(calls[2][1].at(-1), /chromium.launch/);
});

test('更新・ブラウザ・試験失敗は以前の成功記録を残さない', async (t) => {
  const directory = await fixture(t);
  await updateDependencies({ directory, run: () => {} });
  await assert.rejects(updateDependencies({ directory, run: () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(fs.access(path.join(directory, '.guard-maintenance.json')));
});
