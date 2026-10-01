import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadConfig, configFile } from './config.mjs';
import { parseEdit } from './edits.mjs';
import { relevantFiles, violations } from './rules.mjs';
import { errorLog, readState, stateHome, statePath, updateState } from './state.mjs';
import { bashHook } from './delegate.mjs';
import { checkDay } from './session-maintenance.mjs';

const suffix = 'Use the render-guard skill (Claude: /render-guard; Codex: $render-guard).';

async function configured(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function editProjects(edit) {
  // 複数プロジェクトを含むパッチでも、設定のある対象だけを検査する。
  const groups = new Map();
  for (const file of edit.files) {
    const config = await loadConfig(path.dirname(file.path));
    if (!await configured(config.file)) continue;
    if (!groups.has(config.root)) groups.set(config.root, { config, edit: { ...edit, files: [] } });
    groups.get(config.root).edit.files.push(file);
  }
  return [...groups.values()];
}

function dateBefore(left, right) {
  // 未記録または不正な時刻を未実測側として比較する。
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return !Number.isFinite(leftTime) || !Number.isFinite(rightTime) || leftTime < rightTime;
}

async function stateEntries() {
  // 全プロジェクト状態を、保存された root とともに読む。
  const home = stateHome();

  if (!home) {
    return [];
  }

  const projects = path.join(home, 'projects');
  let directories = [];

  try {
    directories = await fs.readdir(projects, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const entries = await Promise.all(directories.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const file = path.join(projects, entry.name, 'state.json');

    try {
      const state = JSON.parse(await fs.readFile(file, 'utf8'));
      const root = state.root || entry.name.replaceAll('%', '/');
      return { root: path.resolve(root), state };
    } catch {
      return null;
    }
  }));

  return entries.filter(Boolean);
}

async function localStateEntries(cwdRoot) {
  // プロジェクト内保存では root 自身と、設定を持つ子プロジェクトだけを見る。
  const roots = new Set([path.resolve(cwdRoot)]);

  async function walk(directory, depth) {
    if (depth > 4) {
      return;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const child = path.join(directory, entry.name);

      if (entry.isFile() && ['css-guard.json', 'svg-guard.json', 'render-guard.json'].includes(entry.name)) {
        if (await configFile(directory)) roots.add(directory);
      } else if (entry.isDirectory() && depth < 4 && !['node_modules', '.git', '.css-guard', '.render-guard', '.runtime'].includes(entry.name)) {
        await walk(child, depth + 1);
      }
    }
  }

  await walk(cwdRoot, 0);
  const result = [];

  for (const root of roots) {
    try {
      await fs.access(statePath(root));
      result.push({ root, state: await readState(root) });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return result;
}

export async function preHook(input) {
  // CSS 編集前に全規則を評価し、違反なら拒否形式を返す。
  const edit = await parseEdit(input);
  const problems = [];
  for (const group of await editProjects(edit)) {
    if (relevantFiles(group.edit, group.config).length) {
      const maintenance = await checkDay();
      if (['needs-update', 'failed', 'checking', 'updating'].includes(maintenance.status)) {
        problems.push('Daily dependency check: ' + maintenance.status + '. Run css-guard update before measurement. Do not repeat checks or tests for each task.');
      }
      problems.push(...violations(group.edit, group.config, await readState(group.config.root)));
    }
  }

  if (!problems.length) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${problems.join('\n')}\n${suffix}`
    }
  };
}

export async function postHook(input) {
  // 編集時刻と、修正後に再実測する対象を記録する。
  const edit = await parseEdit(input);
  const at = new Date().toISOString();
  for (const { config, edit: projectEdit } of await editProjects(edit)) {
    const files = relevantFiles(projectEdit, config);
    if (!files.length) continue;
    await updateState(config.root, (state) => ({
      ...state,
      lastCssEditAt: at,
      pendingMeasure: state.pendingMeasure || state.lastMeasure,
      cssEdits: [
        ...(state.cssEdits || []),
        ...files.map((file) => ({
          file: path.relative(config.root, file.path),
          at,
          tool: edit.tool
        }))
      ]
    }));
  }

  return null;
}

export async function stopHook(input) {
  // cwd と同じか配下で編集された全状態について再実測を確認する。
  const cwdConfig = await loadConfig(input.cwd || process.cwd());
  const cwdRoot = path.resolve(cwdConfig.root);
  const entries = stateHome() ? await stateEntries() : await localStateEntries(cwdRoot);

  for (const entry of entries) {
    if (entry.root !== cwdRoot && !entry.root.startsWith(`${cwdRoot}${path.sep}`)) {
      continue;
    }

    const { root, state } = entry;
    if (!await configFile(root)) continue;
    const edited = state.cssEdits?.length > 0 && state.lastCssEditAt;
    const unmeasured = state.pendingMeasure || !state.lastMeasureAt || dateBefore(state.lastMeasureAt, state.lastCssEditAt);

    if (!edited || !unmeasured || input.stop_hook_active || state.stopBlockedAt === state.lastCssEditAt) {
      continue;
    }

    await updateState(root, (current) => ({ ...current, stopBlockedAt: current.lastCssEditAt }));
    let reason = `The same target has not been remeasured after the CSS edit (${root}). Run css-guard measure with the same URL, selector, state, and viewport widths; briefly report before/after values and out-of-scope effects.`;

    try {
      const config = await loadConfig(root);

      if (config.routes?.length && (!state.lastSnapCheckAt || dateBefore(state.lastSnapCheckAt, state.lastCssEditAt))) {
        reason += ' Also run `css-guard snap` to check for changes on other configured routes.';
      }
    } catch {
      // 根が消えた状態でも再実測不足は通知する。
    }

    return { decision: 'block', reason };
  }

  return null;
}

export async function runHook(kind, input) {
  // フック全体を失敗時も通す境界として実行する。
  let parsed;

  try {
    parsed = typeof input === 'function' ? await input() : input;
    if (kind === 'hook-bash') {
      const config = await loadConfig(parsed.cwd || process.cwd());
      if (await configured(config.file)) await checkDay();
    }
    const handlers = { 'hook-pre': preHook, 'hook-post': postHook, 'hook-stop': stopHook, 'hook-bash': bashHook };
    return await handlers[kind](parsed);
  } catch (error) {
    try {
      const root = await findProjectRoot(parsed?.cwd || process.cwd());
      await errorLog(root, error);
    } catch {
      // フックは例外時も必ず許可側に倒す。
    }

    return null;
  }
}
