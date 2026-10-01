#!/usr/bin/env node
// フック設定の雛形を、既存の設定ファイルへ二重登録せずに足す。
// 使い方: node scripts/merge-hooks.mjs <導入先ROOT> <雛形JSON> <書き込む設定JSON>
// 雛形の __ROOT__ を導入先に置き換え、css-guard のフックだけを入れ替える（他のフック・設定は残す）。
// 既存ファイルは <設定>.bak.<日時> に控えを取る。
import fs from 'node:fs';
import path from 'node:path';

const [root, source, target] = process.argv.slice(2);

if (!root || !source || !target) {
  process.stderr.write('Usage: merge-hooks.mjs <ROOT> <template> <settings-file>\n');
  process.exit(1);
}

const ours = (hook) => typeof hook?.command === 'string' && hook.command.includes(`${root}/bin/css-guard.mjs`);
const addition = JSON.parse(fs.readFileSync(source, 'utf8').replaceAll('__ROOT__', root));
let current = {};
let existed = false;

try {
  current = JSON.parse(fs.readFileSync(target, 'utf8'));
  existed = true;
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

current.hooks ||= {};

for (const [event, groups] of Object.entries(addition.hooks)) {
  const retained = (current.hooks[event] || [])
    .map((group) => ({ ...group, hooks: (group.hooks || []).filter((hook) => !ours(hook)) }))
    .filter((group) => group.hooks.length);
  current.hooks[event] = retained.concat(groups.filter((group) => group.hooks?.some(ours)));
}

if (existed) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  fs.copyFileSync(target, `${target}.bak.${stamp}`);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`);
process.stdout.write(`Updated ${target}${existed ? ' (backup: same name with .bak.<timestamp>)' : ''}\n`);
