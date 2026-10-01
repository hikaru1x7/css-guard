import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cli, codexPatch, json } from './helpers.mjs';

function withoutSharedHome() {
  const env = { ...process.env };
  delete env.CSS_GUARD_HOME;
  return env;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function gitProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-local-state-'));
  git(root, ['init', '-q']);
  return { root, env: withoutSharedHome() };
}

test('既定ではプロジェクト内へ保存し、Git の個別除外は一度だけ追加する', async () => {
  const project = await gitProject();

  json(await cli(project, ['begin', '--scope', 'a.css']));
  await fs.access(path.join(project.root, '.css-guard', 'state.json'));
  assert.doesNotMatch(git(project.root, ['status', '--short']), /.css-guard/);

  const exclude = path.join(project.root, '.git', 'info', 'exclude');
  assert.equal((await fs.readFile(exclude, 'utf8')).split(/\r?\n/).filter((line) => line === '.css-guard/').length, 1);

  json(await cli(project, ['begin', '--scope', 'a.css']));
  assert.equal((await fs.readFile(exclude, 'utf8')).split(/\r?\n/).filter((line) => line === '.css-guard/').length, 1);
});

test('Git の個別除外に書けなくても begin は状態を初期化する', async () => {
  const project = await gitProject();
  const info = path.join(project.root, '.git', 'info');
  const exclude = path.join(info, 'exclude');
  const originalMode = (await fs.stat(info)).mode & 0o777;

  await fs.rm(exclude);
  await fs.chmod(info, 0o555);
  try {
    const result = await cli(project, ['begin', '--scope', 'a.css']);
    json(result);
    await fs.access(path.join(project.root, '.css-guard', 'state.json'));
    assert.equal(result.stderr, 'Could not update Git exclusions (add .css-guard/ to .gitignore)\n');
  } finally {
    await fs.chmod(info, originalMode);
  }
});

test('既定の Stop は子プロジェクトの .css-guard/state.json を判定する', async () => {
  const project = await gitProject();
  const sub = path.join(project.root, 'sub');
  const file = path.join(sub, 'a.css');
  await fs.mkdir(sub);
  await fs.writeFile(path.join(sub, 'css-guard.json'), JSON.stringify({ requireScope: false, requireMeasure: false }));
  await fs.writeFile(file, '.box{width:100px}\n');
  await fs.writeFile(file, '.box{width:120px}\n');

  await cli({ root: sub, env: project.env }, ['hook-post'], JSON.stringify({
    cwd: sub,
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: codexPatch(file) }
  }));
  await fs.access(path.join(sub, '.css-guard', 'state.json'));

  const stop = await cli(project, ['hook-stop'], JSON.stringify({
    cwd: project.root,
    hook_event_name: 'Stop',
    stop_hook_active: false
  }));
  assert.equal(json(stop).decision, 'block');
  assert.match(json(stop).reason, /sub/);
});
