import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { parseEdit, parsePatch } from '../lib/edits.mjs';

test('Claude Edit と Write を共通形式へ変換する', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-edit-')); const target = path.join(cwd, 'a.css'); await fs.writeFile(target, 'old\n');
  const edit = await parseEdit({ cwd, tool_name: 'Edit', tool_input: { file_path: 'a.css', old_string: 'old', new_string: 'new' } });
  assert.deepEqual(edit.files[0], { path: target, kind: 'edit', removed: ['old'], added: ['new'] });
  const write = await parseEdit({ cwd, tool_name: 'Write', tool_input: { file_path: target, content: 'new' } }); assert.equal(write.files[0].kind, 'write'); assert.deepEqual(write.files[0].removed, ['old', '']);
  const add = await parseEdit({ cwd, tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'new.css'), content: 'x' } }); assert.equal(add.files[0].kind, 'add');
});
test('Codex patch の Add Update Delete Move と複数ファイルを変換する', () => {
  const files = parsePatch('*** Begin Patch\n*** Add File: a.css\n+x\n*** Update File: b.css\n*** Move to: c.css\n@@\n-old\n+new\n*** Delete File: d.css\n*** End Patch', '/tmp/project');
  assert.equal(files.length, 3); assert.deepEqual(files.map((file) => file.kind), ['add', 'edit', 'delete']); assert.equal(files[1].moveTo, '/tmp/project/c.css'); assert.deepEqual(files[1].removed, ['old']); assert.deepEqual(files[1].added, ['new']);
});
