import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { webMode } from './config.mjs';

const warnedGitExcludeFiles = new Set();

const empty = () => ({
  scope: null,
  lastMeasureAt: null,
  lastMeasure: null,
  pendingMeasure: null,
  lastCssEditAt: null,
  cssEdits: [],
  lastSnapCheckAt: null,
  stopBlockedAt: null,
  approvals: []
});

export function stateHome() {
  // 互換用の共通保存先。未指定時はプロジェクト内へ保存する。
  if (webMode() === 'svg') return process.env.SVG_GUARD_HOME || (process.env.CSS_GUARD_HOME ? path.join(process.env.CSS_GUARD_HOME, 'svg') : null);
  return process.env.CSS_GUARD_HOME || null;
}

export function slug(root) {
  // 絶対パスを状態ディレクトリ名に変換する。
  return path.resolve(root).replaceAll('/', '%');
}

export function projectDir(root) {
  // 共通保存先の指定時だけ slug ごとのディレクトリを使う。
  return stateHome()
    ? path.join(stateHome(), 'projects', slug(root))
    : path.join(path.resolve(root), webMode() === 'svg' ? '.render-guard/svg' : '.css-guard');
}

export function statePath(root) {
  // state.json の保存先を返す。
  return path.join(projectDir(root), 'state.json');
}

function gitInfoExclude(root) {
  // Git 管理下なら、その worktree 用の exclude ファイルを返す。
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });

  if (top.status !== 0) {
    return null;
  }

  const gitPath = spawnSync('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });

  if (gitPath.status !== 0) {
    return null;
  }

  return { root: top.stdout.trim(), file: path.resolve(root, gitPath.stdout.trim()) };
}

async function ensureGitExclude(root) {
  // リポジトリ本体の .gitignore は変えず、プロジェクト別の状態を除外する。
  const info = gitInfoExclude(root);

  if (!info) {
    return;
  }

  try {
    const relativeRoot = path.relative(info.root, path.resolve(root)).split(path.sep).join('/');
    const entry = `${relativeRoot ? `${relativeRoot}/` : ''}${webMode() === 'svg' ? '.render-guard/' : '.css-guard/'}`;
    let contents = '';

    try {
      contents = await fs.readFile(info.file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (contents.split(/\r?\n/).includes(entry)) {
      return;
    }

    await fs.mkdir(path.dirname(info.file), { recursive: true });
    await fs.appendFile(info.file, `${contents && !contents.endsWith('\n') ? '\n' : ''}${entry}\n`);
  } catch {
    if (!warnedGitExcludeFiles.has(info.file)) {
      warnedGitExcludeFiles.add(info.file);
      process.stderr.write('Could not update Git exclusions (add .css-guard/ to .gitignore)\n');
    }
  }
}

export async function ensureProject(root) {
  // プロジェクト別の状態ディレクトリを作って返す。
  await ensureGitExclude(root);
  const directory = projectDir(root);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function readState(root) {
  // 状態がなければ空の状態として読み込む。
  try {
    return { ...empty(), ...JSON.parse(await fs.readFile(statePath(root), 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return empty();
    }

    throw error;
  }
}

export async function writeState(root, state) {
  // 状態を一時ファイル経由で安全に保存する。
  const dir = await ensureProject(root);
  const target = path.join(dir, 'state.json');
  const tmp = path.join(dir, `.state-${process.pid}-${Date.now()}.tmp`);
  const saved = { ...state, root: path.resolve(root) };
  await fs.writeFile(tmp, `${JSON.stringify(saved, null, 2)}\n`);
  await fs.rename(tmp, target);
  return saved;
}

export async function updateState(root, fn) {
  // 現在の状態を更新関数へ渡して保存する。
  const result = await fn(await readState(root));
  await writeState(root, result);
  return result;
}

export async function resetState(root, scope) {
  // 計測物を消して、指定範囲だけを持つ新しい状態にする。
  const dir = await ensureProject(root);

  await Promise.all(['measures', 'shots', 'snap'].map(async (name) => {
    const target = path.join(dir, name);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });
  }));

  return writeState(root, {
    ...empty(),
    scope: { patterns: scope, at: new Date().toISOString() }
  });
}

export async function errorLog(root, error) {
  // プロジェクトごとのフック例外を追記する。
  const dir = await ensureProject(root);
  const line = `[${new Date().toISOString()}] ${error.stack || error}\n`;
  await fs.appendFile(path.join(dir, 'errors.log'), line);
}
