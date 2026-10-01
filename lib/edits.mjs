import fs from 'node:fs/promises';
import path from 'node:path';

const lines = (value = '') => String(value).split(/\r?\n/);
const filePath = (value, cwd) => path.resolve(cwd || process.cwd(), value);

export async function parseEdit(input) {
  // Claude と Codex の編集入力を共通形式にする。
  const cwd = input.cwd || process.cwd();
  const tool = input.turn_id ? 'codex' : 'claude';

  if (input.tool_name === 'MultiEdit') {
    return {
      tool,
      files: [{ path: filePath(input.tool_input.file_path, cwd), kind: 'edit',
        removed: (input.tool_input.edits || []).flatMap((edit) => lines(edit.old_string)),
        added: (input.tool_input.edits || []).flatMap((edit) => lines(edit.new_string)) }]
    };
  }

  if (input.tool_name === 'Edit') {
    return {
      tool,
      files: [{
        path: filePath(input.tool_input.file_path, cwd),
        kind: 'edit',
        removed: lines(input.tool_input.old_string),
        added: lines(input.tool_input.new_string)
      }]
    };
  }

  if (input.tool_name === 'Write') {
    const target = filePath(input.tool_input.file_path, cwd);
    let old;

    try {
      old = await fs.readFile(target, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return {
      tool,
      files: [{
        path: target,
        kind: old === undefined ? 'add' : 'write',
        removed: old === undefined ? [] : lines(old),
        added: lines(input.tool_input.content)
      }]
    };
  }

  if (input.tool_name !== 'apply_patch') {
    return { tool, files: [] };
  }

  const patch = typeof input.tool_input === 'string' ? input.tool_input : input.tool_input?.command || input.tool_input?.input || input.tool_input?.patch || '';
  return { tool, files: parsePatch(patch, cwd) };
}

export function parsePatch(patch, cwd = process.cwd()) {
  // Codex の apply_patch からファイル別の差分と文脈を取り出す。
  const result = [];
  let current = null;
  let hunkAnchor = null;

  for (const line of String(patch).split(/\r?\n/)) {
    const file = line.match(/^\*\*\* (Add|Delete|Update) File: (.+)$/);

    if (file) {
      current = {
        path: filePath(file[2], cwd),
        kind: ({ Add: 'add', Delete: 'delete', Update: 'edit' })[file[1]],
        removed: [],
        added: [],
        anchors: []
      };
      result.push(current);
      hunkAnchor = null;
      continue;
    }

    if (/^\*\*\* Move to: /.test(line) && current) {
      current.moveTo = filePath(line.slice('*** Move to: '.length), cwd);
      continue;
    }

    if (!current || /^\*\*\* (Begin Patch|End Patch|End of File)$/.test(line)) {
      continue;
    }

    if (line.startsWith('@@')) {
      hunkAnchor = null;
      continue;
    }

    if (line.startsWith('-')) {
      current.removed.push(line.slice(1));

      if (hunkAnchor === null) {
        hunkAnchor = line.slice(1);
        current.anchors.push(hunkAnchor);
      }

      continue;
    }

    if (line.startsWith('+')) {
      current.added.push(line.slice(1));
      continue;
    }

    if (line.startsWith(' ') && hunkAnchor === null) {
      hunkAnchor = line.slice(1);
      current.anchors.push(hunkAnchor);
    }
  }

  return result;
}
