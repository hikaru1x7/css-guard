import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cli, codexPatch, json, tempProject } from './helpers.mjs';
import { slug } from '../lib/state.mjs';

const event = (project, name, extra = {}) => ({ session_id: 's', turn_id: 't', cwd: project.root, hook_event_name: name, tool_name: 'apply_patch', tool_input: { command: codexPatch(path.join(project.root, 'css/a.css')) }, ...extra });
test('設定のないプロジェクトは Codex・Claude とも検査・状態保存しない', async () => {
  const project = await tempProject();
  await fs.unlink(path.join(project.root, 'css-guard.json'));
  const inputs = [event(project, 'PreToolUse'), event(project, 'PreToolUse', {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(project.root, 'css/a.css'), old_string: '.box{width:100px}', new_string: '.box{width:120px}' }
  })];
  for (const input of inputs) {
    for (const hook of ['hook-pre', 'hook-post']) {
      const result = await cli(project, [hook], JSON.stringify(input));
      assert.equal(result.code, 0);
      assert.equal(result.stdout, '');
    }
  }
  await assert.rejects(fs.access(path.join(project.home, 'projects', slug(project.root), 'state.json')), { code: 'ENOENT' });
});
test('混在パッチでも設定のあるプロジェクトだけを検査・記録する', async () => {
  const project = await tempProject();
  const plain = await tempProject();
  await fs.unlink(path.join(plain.root, 'css-guard.json'));
  const patch = codexPatch(path.join(plain.root, 'css/a.css')).replace('*** End Patch', '') +
    codexPatch(path.join(project.root, 'css/a.css')).replace('*** Begin Patch\n', '');
  const input = event(project, 'PreToolUse', { tool_input: { command: patch } });
  assert.equal(json(await cli(project, ['hook-pre'], JSON.stringify(input))).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await cli(project, ['hook-post'], JSON.stringify(input))).stdout, '');
  const state = JSON.parse(await fs.readFile(path.join(project.home, 'projects', slug(project.root), 'state.json'), 'utf8'));
  assert.equal(state.cssEdits.length, 1);
  assert.equal(state.cssEdits[0].file, 'css/a.css');
  await assert.rejects(fs.access(path.join(project.home, 'projects', slug(plain.root), 'state.json')), { code: 'ENOENT' });
});
test('連続編集を通し、別対象・幅不足の実測では完了を認めない', async () => {
  const project = await tempProject({ static: '.', routes: [] });
  await fs.writeFile(path.join(project.root, 'index.html'), '<link rel="stylesheet" href="css/a.css"><div id="b" class="box">test</div>');
  json(await cli(project, ['begin', '--scope', 'css/a.css']));
  const first = json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280,375']));
  assert.equal(first.widths[0].target.rect.width, 100);
  assert.equal((await cli(project, ['hook-pre'], JSON.stringify(event(project, 'PreToolUse')))).stdout, '');
  await fs.writeFile(path.join(project.root, 'css/a.css'), '.box{width:120px}\n');
  await cli(project, ['hook-post'], JSON.stringify(event(project, 'PostToolUse')));
  assert.equal((await cli(project, ['hook-pre'], JSON.stringify(event(project, 'PreToolUse')))).stdout, '');
  await fs.writeFile(path.join(project.root, 'css/a.css'), '.box{width:140px}\n');
  await cli(project, ['hook-post'], JSON.stringify(event(project, 'PostToolUse')));
  assert.equal((await cli(project, ['verify'])).code, 1);
  json(await cli(project, ['measure', '/index.html', 'body', '--widths', '1280,375']));
  assert.equal((await cli(project, ['verify'])).code, 1);
  json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280']));
  assert.equal((await cli(project, ['verify'])).code, 1);
  const blocked = json(await cli(project, ['hook-stop'], JSON.stringify({ cwd: project.root })));
  assert.equal(blocked.decision, 'block');
  const after = json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280,375']));
  assert.equal(after.widths[0].target.rect.width, 140);
  assert.equal((await cli(project, ['verify'])).code, 0);
});
test('begin → measure → 許可 → post → stop差し戻し → measure → stop通過', async () => {
  const project = await tempProject();
  json(await cli(project, ['begin', '--scope', 'css/*.css']));
  const measured = json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280,375'])); assert.equal(measured.widths.length, 2);
  const pre = await cli(project, ['hook-pre'], JSON.stringify(event(project, 'PreToolUse'))); assert.equal(pre.code, 0); assert.equal(pre.stdout, '');
  const post = await cli(project, ['hook-post'], JSON.stringify(event(project, 'PostToolUse'))); assert.equal(post.stdout, '');
  const blocked = json(await cli(project, ['hook-stop'], JSON.stringify({ cwd: project.root, hook_event_name: 'Stop', stop_hook_active: false }))); assert.equal(blocked.decision, 'block');
  assert.equal((await cli(project, ['hook-stop'], JSON.stringify({ cwd: project.root, hook_event_name: 'Stop', stop_hook_active: false }))).stdout, '');
  json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280,375']));
  assert.equal((await cli(project, ['hook-stop'], JSON.stringify({ cwd: project.root, hook_event_name: 'Stop', stop_hook_active: false }))).stdout, '');
});
test('非 CSS 編集は無出力、stop_hook_active は差し戻さない', async () => {
  const project = await tempProject(); const patch = codexPatch(path.join(project.root, 'note.md'), '# note', '# changed');
  const result = await cli(project, ['hook-pre'], JSON.stringify({ ...event(project, 'PreToolUse'), tool_input: { command: patch } })); assert.equal(result.code, 0); assert.equal(result.stdout, '');
  json(await cli(project, ['begin', '--scope', 'css/*.css'])); json(await cli(project, ['measure', '/index.html', '#b'])); await cli(project, ['hook-post'], JSON.stringify(event(project, 'PostToolUse')));
  const stop = await cli(project, ['hook-stop'], JSON.stringify({ cwd: project.root, hook_event_name: 'Stop', stop_hook_active: true })); assert.equal(stop.stdout, '');
});
test('Claude Code の Edit stdin も同じ deny 形式を返す', async () => {
  const project = await tempProject();
  const stdin = { session_id: 's', cwd: project.root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(project.root, 'css/a.css'), old_string: '.box{width:100px}', new_string: '.box{width:120px}' } };
  const result = json(await cli(project, ['hook-pre'], JSON.stringify(stdin)));
  assert.equal(result.hookSpecificOutput.hookEventName, 'PreToolUse'); assert.equal(result.hookSpecificOutput.permissionDecision, 'deny'); assert.match(result.hookSpecificOutput.permissionDecisionReason, /R1/);
});

test('R4 は保護ブロック内の宣言だけを編集した Claude と Codex の入力を拒否する', async () => {
  const project = await tempProject({ requireScope: false, requireMeasure: false, protectedSelectors: ['.btn'] });
  const protectedFile = path.join(project.root, 'css/a.css');
  await fs.writeFile(protectedFile, '.btn {\n  color: red;\n  padding: 4px;\n}\n.btn-group {\n  padding: 4px;\n}\n');
  const claude = {
    session_id: 's',
    cwd: project.root,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: protectedFile,
      old_string: '  padding: 4px;',
      new_string: '  padding: 8px;'
    }
  };
  const codex = {
    ...event(project, 'PreToolUse'),
    tool_input: {
      command: codexPatch(protectedFile, '  padding: 4px;', '  padding: 8px;')
    }
  };

  assert.match(json(await cli(project, ['hook-pre'], JSON.stringify(claude))).hookSpecificOutput.permissionDecisionReason, /R4/);
  assert.match(json(await cli(project, ['hook-pre'], JSON.stringify(codex))).hookSpecificOutput.permissionDecisionReason, /R4/);
  const group = {
    ...claude,
    tool_input: {
      ...claude.tool_input,
      old_string: '.btn-group {\n  padding: 4px;\n}',
      new_string: '.btn-group {\n  padding: 8px;\n}'
    }
  };
  assert.doesNotMatch((await cli(project, ['hook-pre'], JSON.stringify(group))).stdout, /R4/);
});

test('Stop は cwd 配下にある設定根の未実測編集を差し戻す', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-stop-'));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-stop-state-'));
  const sub = path.join(root, 'sub');
  const project = { root: sub, env: { ...process.env, CSS_GUARD_HOME: home } };
  await fs.mkdir(sub);
  await fs.writeFile(path.join(sub, 'css-guard.json'), JSON.stringify({ requireScope: false, requireMeasure: false }));
  await fs.writeFile(path.join(sub, 'a.css'), '.box { color: red; }\n');
  const post = {
    session_id: 's',
    turn_id: 't',
    cwd: sub,
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: codexPatch(path.join(sub, 'a.css')) }
  };
  await cli(project, ['hook-post'], JSON.stringify(post));
  const stop = await cli({ root, env: project.env }, ['hook-stop'], JSON.stringify({ cwd: root, hook_event_name: 'Stop', stop_hook_active: false }));

  assert.equal(json(stop).decision, 'block');
  assert.match(json(stop).reason, /sub/);
});

test('壊れたフック入力は無出力で通し、プロジェクト別 errors.log に残す', async () => {
  const project = await tempProject();
  const result = await cli(project, ['hook-pre'], '{');

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  await fs.access(path.join(project.home, 'projects', slug(project.root), 'errors.log'));
});
