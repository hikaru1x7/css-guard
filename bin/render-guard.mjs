#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { checkDay } from '../lib/session-maintenance.mjs';
import { parseEdit } from '../lib/edits.mjs';
import { combineHooks, present } from '../lib/render-routing.mjs';
import { documentHook, documentCommand } from '../lib/documents.mjs';

const root = path.resolve(import.meta.dirname, '..');
const values = process.argv.slice(2);
const python = process.env.RENDER_GUARD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

export function run(mode, args, input = '', capture = false) {
  const gui = mode === 'gui';
  return new Promise((resolve, reject) => {
    const projectIndex = args.indexOf('--project');
    const cwd = !gui && projectIndex >= 0 && args[projectIndex + 1] ? path.resolve(args[projectIndex + 1]) : undefined;
    const child = spawn(gui ? python : process.execPath,
      [path.join(root, gui ? 'engines/gui/scripts/gui-guard.py' : 'bin/css-guard.mjs'), ...args], {
        cwd, env: { ...process.env, RENDER_GUARD_MODE: mode },
        stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit']
      });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function isConfigured(input) {
  const edit = await parseEdit(input);
  const starts = [input.cwd || process.cwd(), ...edit.files.map((file) => path.dirname(file.path))];
  for (const start of starts) {
    let directory = path.resolve(start);
    for (;;) {
      for (const name of ['render-guard.json', 'css-guard.json', 'gui-guard.json', 'svg-guard.json']) {
        try {
          if (name !== 'render-guard.json') { await fs.access(path.join(directory, name)); return true; }
          const config = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
          if (['css', 'gui', 'svg'].some((mode) => config[mode])) return true;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return false;
}

async function hook(kind) {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw || '{}'); } catch {
    process.stdout.write(JSON.stringify(combineHooks(kind, [{ decision: 'block', reason: 'RenderGuard: malformed hook input; no verification was performed.' }])) + '\n');
    return;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input.cwd !== undefined && typeof input.cwd !== 'string') || (['hook-pre', 'hook-post', 'hook-bash'].includes(kind) && input.tool_input !== undefined && (input.tool_input === null || !['object', 'string'].includes(typeof input.tool_input)))) {
    process.stdout.write(JSON.stringify(combineHooks(kind, [{ decision: 'block', reason: 'RenderGuard: invalid hook input; no verification was performed.' }])) + '\n');
    return;
  }
  if (['hook-pre', 'hook-bash'].includes(kind) && await isConfigured(input)) {
    // The first applicable hook checks both toolchains. Engines reuse these
    // records; switching tasks, projects or modes causes no network request.
    await Promise.allSettled([checkDay(), run('gui', ['maintenance-check'], '', true)]);
  }
  raw = JSON.stringify(input).replace(/render-guard:\s*none/g, 'css-guard: none --> <!-- gui-guard: none');
  const documentResult = await documentHook(kind, input);
  const modes = kind === 'hook-post' && input.tool_name === 'Bash' ? [] : ['css', 'svg', 'gui'];
  const results = await Promise.all(modes.map(async (mode) => {
    try {
      const result = await run(mode, [kind], raw, true);
      if (result.stdout.trim()) {
        const output = JSON.parse(result.stdout);
        if (output.hookSpecificOutput?.permissionDecisionReason) output.hookSpecificOutput.permissionDecisionReason = present(output.hookSpecificOutput.permissionDecisionReason, mode);
        if (output.reason) output.reason = present(output.reason, mode);
        return output;
      }
      if (result.code) throw new Error(result.stderr || `${mode} hook failed`);
      return null;
    } catch (error) {
      // A failed engine cannot discard another engine's rejection.
      return { decision: 'block', reason: `RenderGuard (${mode}): ${error.message}` };
    }
  }));
  const output = combineHooks(kind, [...results, documentResult]);
  if (output) process.stdout.write(JSON.stringify(output) + '\n');
}

async function main() {
  const [command, ...args] = values;
  if (!command || ['--help', '-h'].includes(command)) {
    process.stdout.write('RenderGuard: update [--force]; css|gui|svg <command>; documents begin|verify|status; hook-pre|hook-post|hook-stop|hook-bash\n');
    return;
  }
  if (command.startsWith('hook-')) return hook(command);
  if (command === 'documents') {
    process.stdout.write(JSON.stringify(await documentCommand(args[0], args.slice(1)), null, 2) + '\n');
    return;
  }
  if (command === 'update') {
    // Keep both established updaters and their once-per-day locking.
    const results = [];
    for (const mode of ['css', 'gui']) {
      const forwarded = mode === 'gui' ? args.filter((arg) => arg !== '--json') : [...args, '--json'];
      const result = await run(mode, ['update', ...forwarded], '', true);
      results.push({ mode, ...result });
      if (result.stderr) process.stderr.write(result.stderr);
    }
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    process.exitCode = results.some((result) => result.code) ? 1 : 0;
    return;
  }
  if (!['css', 'gui', 'svg'].includes(command)) throw new Error('Choose css, gui or svg before the engine command.');
  if (args[0] === 'packet') {
    const result = await run(command, args, '', true);
    if (args.includes('--json') && result.code === 0) {
      const value = JSON.parse(result.stdout);
      value.text = present(value.text, command);
      process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    } else process.stdout.write(present(result.stdout, command));
    process.stderr.write(present(result.stderr, command));
    process.exitCode = result.code;
    return;
  }
  const result = await run(command, args);
  process.exitCode = result.code;
}

main().catch((error) => {
  process.stderr.write(`RenderGuard: ${error.message}\n`);
  if (values[0]?.startsWith('hook-')) {
    process.stdout.write(JSON.stringify(combineHooks(values[0], [{ decision: 'block', reason: `DesignGuard: ${error.message}` }])) + '\n');
    process.exitCode = 0;
  } else process.exitCode = 1;
});
