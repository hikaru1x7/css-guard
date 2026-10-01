#!/usr/bin/env node
// Merge this checkout's combined hooks; preserve all unrelated settings.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [root, source, target, oldGui = path.join(os.homedir(), '.codex/skills/gui-guard/scripts/gui-guard.py')] = process.argv.slice(2);
if (!root || !source || !target) throw new Error('Usage: merge-hooks.mjs <ROOT> <template> <settings> [old-GUI-script]');
const quote = (value) => /^[A-Za-z0-9_./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
const script = path.join(root, 'bin/render-guard.mjs');
const oldCss = path.join(root, 'bin/css-guard.mjs');
const kinds = ['hook-pre', 'hook-post', 'hook-stop', 'hook-bash'];
const owned = new Set(kinds.flatMap((kind) => [
  'node ' + quote(script) + ' ' + kind, 'node ' + quote(oldCss) + ' ' + kind, 'python3 ' + quote(oldGui) + ' ' + kind
]));
const ours = (hook) => owned.has(hook?.command);
const addition = JSON.parse(fs.readFileSync(source, 'utf8'));
for (const groups of Object.values(addition.hooks)) for (const group of groups) for (const hook of group.hooks || []) {
  hook.command = hook.command.replaceAll('__ROOT__/bin/render-guard.mjs', quote(script));
}
let current = {};
try { current = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const original = JSON.stringify(current);
current.hooks ||= {};
for (const [event, groups] of Object.entries(addition.hooks)) {
  const retained = (current.hooks[event] || []).map((group) => ({ ...group, hooks: (group.hooks || []).filter((hook) => !ours(hook)) })).filter((group) => group.hooks.length);
  current.hooks[event] = retained.concat(groups);
}
if (JSON.stringify(current) === original) {
  process.stdout.write(target + ': unchanged\n');
} else {
  if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak.render-guard-' + Date.now());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
  process.stdout.write(target + ': RenderGuard hooks installed; review Codex hook trust separately\n');
}
