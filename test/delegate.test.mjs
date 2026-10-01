import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cli, codexPatch, json, tempProject } from './helpers.mjs';
import { parseCodexInvocation } from '../lib/delegate.mjs';

const bash = (project, command, cwd = project.root) => cli(project, ['hook-bash'], JSON.stringify({
  session_id: 's',
  cwd,
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command }
}));

async function packetFile(project, contents) {
  // 指示書をプロジェクト内に置いて相対パスを返す。
  const file = path.join(project.root, 'packet.md');
  await fs.writeFile(file, contents);
  return file;
}

test('packet は目印・作業する木・画面・幅・範囲を含む段落を出す', async () => {
  const project = await tempProject({ widths: [1280, 375], protectedSelectors: [':root'] });
  const result = json(await cli(project, ['packet', '--scope', 'css/*.css', '--url', '/index.html', '--selector', '#b']));
  assert.equal(result.root, project.root);
  assert.match(result.text, new RegExp(`<!-- css-guard packet v1 root=${project.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->`));
  assert.match(result.text, /Working tree: /);
  assert.match(result.text, /Static directory/);
  assert.match(result.text, /1280, 375/);
  assert.match(result.text, /css-guard begin --scope "css\/\*\.css" --snap/);
  assert.match(result.text, /css-guard measure \/index\.html "#b" --label before/);
  assert.match(result.text, /view_image/);
  assert.match(result.text, /:root/);
});

test('parseCodexInvocation は起動場所・サンドボックス・指示書の在り処を読む', () => {
  const parsed = parseCodexInvocation('cd ~/work && timeout 20m codex exec --ephemeral --sandbox workspace-write -m gpt --cd sub -o out.md - < packet.md');
  assert.equal(parsed.cwd, path.join(os.homedir(), 'work'));
  assert.equal(parsed.sandbox, 'workspace-write');
  assert.equal(parsed.cd, 'sub');
  assert.equal(parsed.stdinFile, 'packet.md');
  assert.deepEqual(parsed.prompts, []);
  assert.equal(parseCodexInvocation('echo "codex exec is not here"'), null);
  assert.equal(parseCodexInvocation('codex exec -s read-only "hello"').sandbox, 'read-only');
  assert.deepEqual(parseCodexInvocation('codex exec --cd=/x \'do this\'').prompts, ['do this']);
});

test('hook-bash は codex exec 以外と読み取り専用の投入を素通しする', async () => {
  const project = await tempProject();
  assert.equal((await bash(project, 'ls -la')).stdout, '');
  assert.equal((await bash(project, 'codex exec --sandbox read-only - < packet.md')).stdout, '');
  assert.equal((await bash(project, 'echo "codex exec --sandbox workspace-write"')).stdout, '');
});

test('hook-bash は css-guard の入った先へ書き込みありで投げる指示書に段落を求める', async () => {
  const project = await tempProject();
  const file = await packetFile(project, '# 目的\n\nCSS を直す\n');
  const denied = json(await bash(project, `codex exec --sandbox workspace-write --cd ${project.root} - < ${file}`));
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /css-guard packet/);
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /css-guard: none/);

  await packetFile(project, '# 目的\n\n<!-- css-guard: none -->\nデータを直す\n');
  assert.equal((await bash(project, `codex exec --sandbox workspace-write - < ${file}`)).stdout, '');

  const packet = json(await cli(project, ['packet', '--scope', 'css/*.css'])).text;
  await packetFile(project, `${packet}\n# 目的\n`);
  assert.equal((await bash(project, `timeout 20m codex exec --ephemeral --sandbox workspace-write --cd ${project.root} - < packet.md`)).stdout, '');
  assert.equal((await bash(project, `codex exec --full-auto - <<'EOF'\n${packet}\n# 目的\nEOF`)).stdout, '');
  assert.equal((await bash(project, `codex exec --dangerously-bypass-approvals-and-sandbox '${packet.replace(/'/g, '')}'`)).stdout, '');
});

test('hook-bash は段落の木と起動場所が違えば拒否し、設定の無い先は素通しする', async () => {
  const project = await tempProject();
  const other = await tempProject();
  const packet = json(await cli(project, ['packet', '--scope', 'css/*.css'])).text;
  const file = await packetFile(other, packet);
  const denied = json(await bash(other, `codex exec --sandbox workspace-write --cd ${other.root} - < ${file}`));
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /working tree/);

  const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-plain-'));
  await fs.writeFile(path.join(plain, 'packet.md'), '# 目的\n');
  assert.equal((await bash(project, `codex exec --sandbox workspace-write --cd ${plain} - < ${path.join(plain, 'packet.md')}`)).stdout, '');
});

test('verify は編集後に再実測と snap が無ければ落ち、済めば通る', async () => {
  const project = await tempProject();
  json(await cli(project, ['begin', '--scope', 'css/*.css']));
  const passed = await cli(project, ['verify']);
  assert.equal(passed.code, 0);
  assert.equal(JSON.parse(passed.stdout).ok, true);

  json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280']));
  await cli(project, ['hook-post'], JSON.stringify({ session_id: 's', turn_id: 't', cwd: project.root, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: codexPatch(path.join(project.root, 'css/a.css')) } }));
  const failed = await cli(project, ['verify']);
  assert.equal(failed.code, 1);
  assert.match(JSON.parse(failed.stdout).problems.join(' '), /have not been remeasured/);

  json(await cli(project, ['measure', '/index.html', '#b', '--widths', '1280']));
  const snapMissing = await cli(project, ['verify']);
  assert.equal(snapMissing.code, 1);
  assert.match(JSON.parse(snapMissing.stdout).problems.join(' '), /snap/);

  json(await cli(project, ['snap', '--widths', '1280']));
  const ok = await cli(project, ['verify']);
  assert.equal(ok.code, 0, ok.stderr);
});
