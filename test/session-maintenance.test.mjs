import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkDay, updateDay } from '../lib/session-maintenance.mjs';
import { preHook } from '../lib/hooks.mjs';
import { installedVersions } from '../lib/maintenance.mjs';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-session-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}

test('同じ日は初回だけ確認し、作業数によらずネット・更新・試験を繰り返さない', async (t) => {
  const home = await fixture(t);
  let checks = 0, updates = 0;
  const options = { home, now: new Date(2026, 9, 2), latest: async () => { checks++; return { playwright: '1.63.0' }; },
    installed: async () => ({ playwright: '1.63.0' }), update: async () => { updates++; } };
  await checkDay(options);
  for (let index = 0; index < 20; index++) {
    assert.equal((await updateDay(options)).skipped, true);
    assert.equal((await checkDay(options)).status, 'current');
  }
  assert.equal(checks, 1); assert.equal(updates, 0);
  await checkDay({ ...options, now: new Date(2026, 9, 3) });
  assert.equal(checks, 2);
});

test('フック先発で新版を検出した後、スキル側の更新は1回だけ行う', async (t) => {
  const home = await fixture(t);
  let checks = 0, updates = 0;
  const options = { home, latest: async () => { checks++; return { playwright: '2' }; },
    installed: async () => ({ playwright: updates ? '2' : '1' }), update: async () => { updates++; return { versions: { playwright: '2' } }; } };
  assert.equal((await checkDay(options)).status, 'needs-update');
  await updateDay(options);
  await updateDay(options);
  assert.equal((await checkDay(options)).status, 'updated');
  assert.equal(checks, 1); assert.equal(updates, 1);
});

test('同時の初回発動でも確認は1回、失敗した日はは自動再試行しない', async (t) => {
  const home = await fixture(t);
  let checks = 0;
  const options = { home, latest: async () => { checks++; await new Promise((resolve) => setTimeout(resolve, 20)); throw new Error('offline'); }, installed: async () => ({}) };
  await Promise.all(Array.from({ length: 10 }, () => checkDay(options)));
  for (let index = 0; index < 5; index++) assert.equal((await checkDay(options)).status, 'failed');
  assert.equal(checks, 1);
});

test('実際の編集前フックはプロジェクトをまたいでもネット確認を共用する', async (t) => {
  const home = await fixture(t), previousHome = process.env.CSS_GUARD_HOME, previousFetch = globalThis.fetch;
  process.env.CSS_GUARD_HOME = home;
  const versions = await installedVersions();
  let requests = 0;
  globalThis.fetch = async (url) => { requests++; return { ok: true, json: async () => ({ version: versions[String(url).split('/').at(-2)] }) }; };
  t.after(() => { globalThis.fetch = previousFetch; if (previousHome === undefined) delete process.env.CSS_GUARD_HOME; else process.env.CSS_GUARD_HOME = previousHome; });
  for (const project of ['a', 'b', 'a']) {
    const root = path.join(home, project);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'css-guard.json'), '{}');
    await fs.writeFile(path.join(root, 'style.css'), '.box { width: 10px; }');
    await preHook({ session_id: 'session-' + project, cwd: root, tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'style.css'), old_string: '10px', new_string: '12px' } });
  }
  await updateDay({ home, update: async () => { throw new Error('再更新は禁止'); } });
  assert.equal(requests, 3); // 3部品を最初の1回だけ取得
});

test('更新コマンドが成功しても実際の版が古ければ更新成功を記録しない', async (t) => {
  const home = await fixture(t);
  const options = { home, latest: async () => ({ playwright: '2' }), installed: async () => ({ playwright: '1' }), update: async () => ({ versions: { playwright: '2' } }) };
  await assert.rejects(updateDay(options), /do not match/);
  assert.equal((await checkDay(options)).status, 'failed');
});
