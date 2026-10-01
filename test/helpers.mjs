import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sessionRecord } from '../lib/session-maintenance.mjs';

export const repo = path.resolve(import.meta.dirname, '..');

export async function tempProject(config = {}) {
  // CSS Guard 用の設定と最小ファイルを持つ一時プロジェクトを作る。
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-project-'));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-state-'));
  await fs.mkdir(path.join(root, 'css'), { recursive: true });
  await fs.writeFile(path.join(root, 'css', 'a.css'), '.box{width:100px}\n');
  await fs.writeFile(path.join(root, 'note.md'), '# note\n');
  await fs.writeFile(path.join(root, 'css-guard.json'), `${JSON.stringify({
    static: path.join(repo, 'test/fixtures/site'),
    routes: ['/index.html'],
    ...config
  })}\n`);

  return { root, home, env: { ...process.env, CSS_GUARD_HOME: home } };
}

export async function cli(project, params, stdin = '') {
  // テスト用に CLI を起動し、通常コマンドは JSON 出力へそろえる。
  const hook = ['hook-pre', 'hook-post', 'hook-stop', 'hook-bash'].includes(params[0]);
  if (hook) {
    let session;
    try { session = JSON.parse(stdin).session_id; } catch {}
    session ||= process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID;
    if (session && project.home) {
      const file = sessionRecord(session, project.home);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ status: 'current' }));
    }
  }
  const command = hook || params.includes('--json') ? params : [...params, '--json'];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repo, 'bin/css-guard.mjs'), ...command], {
      cwd: project.root,
      env: project.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

export function json(result) {
  // 成功した CLI 出力を JSON として返す。
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export const codexPatch = (file, before = '.box{width:100px}', after = '.box{width:120px}') => `*** Begin Patch
*** Update File: ${file}
@@
-${before}
+${after}
*** End Patch`;
