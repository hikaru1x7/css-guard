import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const defaults = {
  widths: [1280, 375],
  routes: [],
  protectedSelectors: [],
  protectedFiles: [],
  styleFiles: ['**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/*.styl', '**/*.pcss'],
  markupFiles: ['**/*.astro', '**/*.html', '**/*.htm', '**/*.vue', '**/*.svelte'],
  gateClassNames: false,
  requireScope: true,
  requireMeasure: true,
  measureMaxAgeMin: 20,
  scopeMaxAgeHours: 6,
  snapThresholdPx: 0
};

export function posixPath(value) {
  // パス区切りを設定ファイル用にそろえる。
  return value.split(path.sep).join('/');
}

export function globToRegExp(glob) {
  // 小さな glob を正規表現に変換する。
  let out = '^';

  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];

    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;

        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }

  return new RegExp(`${out}$`);
}

export function matchesGlob(value, pattern) {
  // 一つの相対パスを glob と照合する。
  return globToRegExp(posixPath(pattern)).test(posixPath(value));
}

export function matchesAny(value, patterns = []) {
  // いずれかの glob と一致するか調べる。
  return patterns.some((pattern) => matchesGlob(value, pattern));
}

export async function findProjectRoot(start = process.cwd()) {
  // 設定ファイル、Git、現在地の順にプロジェクト根を決める。
  let dir = path.resolve(start);

  try {
    const stat = await fs.stat(dir);

    if (!stat.isDirectory()) {
      dir = path.dirname(dir);
    }
  } catch {
    dir = path.dirname(dir);
  }

  for (;;) {
    try {
      await fs.access(path.join(dir, 'css-guard.json'));
      return dir;
    } catch {
      // 親ディレクトリを続けて探す。
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: path.resolve(start),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });

  return git.status === 0 ? git.stdout.trim() : path.resolve(start);
}

export async function loadConfig(start = process.cwd()) {
  // 根の設定を既定値に重ねて読み込む。
  const root = await findProjectRoot(start);
  let given = {};
  const file = path.join(root, 'css-guard.json');

  try {
    given = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Cannot read css-guard.json: ${error.message}`);
    }
  }

  if (given.baseUrl && given.static) {
    throw new Error('css-guard.json cannot specify both baseUrl and static');
  }

  return { root, file, ...defaults, ...given };
}

export function relativePath(root, file) {
  // 絶対パスを設定照合用の相対パスにする。
  return posixPath(path.relative(root, path.resolve(file)));
}
