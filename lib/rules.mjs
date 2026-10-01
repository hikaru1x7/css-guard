import fs from 'node:fs';
import { matchesAny, relativePath } from './config.mjs';

const classNameFiles = ['**/*.jsx', '**/*.tsx', '**/*.js', '**/*.ts', '**/*.astro', '**/*.html', '**/*.htm', '**/*.vue', '**/*.svelte'];
const cssDeclaration = /^\s*[a-zA-Z-]+\s*:\s*[^;{}]+;?\s*$/;

const now = () => Date.now();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function validDate(value) {
  // 日付を時刻に変換し、不正値を失効として扱える形にする。
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function expired(value, ageMs, at) {
  // 未設定・不正・期限超過を一つの失効判定にまとめる。
  const time = validDate(value);
  return time === null || at - time > ageMs;
}

function selectorPattern(selector) {
  // 保護セレクタの境界を含む照合式を作る。
  return new RegExp(`^\\s*${escape(selector)}(?=[\\s,{:.\\[>+~]|$)`);
}

function selectorFromPosition(source, position) {
  // 編集位置を囲む最も内側のルールのセレクタを取り出す。
  const stack = [];

  for (let index = 0; index < position; index++) {
    if (source[index] === '{') {
      stack.push(index);
    } else if (source[index] === '}') {
      stack.pop();
    }
  }

  const opening = stack.at(-1);

  if (opening === undefined) {
    return null;
  }

  const precedingOpening = source.lastIndexOf('{', opening - 1);
  const precedingClosing = source.lastIndexOf('}', opening - 1);
  const start = Math.max(precedingOpening, precedingClosing) + 1;
  return source.slice(start, opening).replace(/\/\*[\s\S]*?\*\//g, '').trim() || null;
}

function blockSelectors(file) {
  // 削除行またはパッチ文脈が現れる全位置のルールを集める。
  if (['write', 'add', 'delete'].includes(file.kind)) {
    return [];
  }

  let source;

  try {
    source = fs.readFileSync(file.path, 'utf8');
  } catch {
    return [];
  }

  const anchors = [file.removed[0], ...(file.anchors || [])].filter(Boolean);
  const found = new Set();

  for (const anchor of anchors) {
    let position = source.indexOf(anchor);

    while (position !== -1) {
      const selector = selectorFromPosition(source, position);

      if (selector) {
        found.add(selector);
      }

      position = source.indexOf(anchor, position + Math.max(anchor.length, 1));
    }
  }

  return [...found];
}

function protectedSelector(lines, config, state) {
  // 変更行または周囲ルールの保護セレクタを返す。
  for (const selector of config.protectedSelectors) {
    const pattern = selectorPattern(selector);

    if (!approved(state, selector) && lines.some((line) => pattern.test(line))) {
      return selector;
    }
  }

  return null;
}

function timestamp(value) {
  // 理由文で未記録時も分かる時刻表示にする。
  return validDate(value) === null ? 'not recorded' : value;
}

export function isCssEdit(file, config) {
  // ファイル種別と変更行から CSS 編集か判定する。
  const rel = relativePath(config.root, file.path);

  if (matchesAny(rel, config.styleFiles)) {
    return true;
  }

  const changed = [...file.removed, ...file.added];

  if (matchesAny(rel, config.markupFiles) && changed.some((line) => /<style|style=["']/.test(line) || cssDeclaration.test(line))) {
    return true;
  }

  return Boolean(config.gateClassNames && matchesAny(rel, classNameFiles) && changed.some((line) => /class(?:Name)?=|class:/.test(line)));
}

export function isProtectedFile(file, config) {
  // 保護ファイルの設定と照合する。
  return matchesAny(relativePath(config.root, file.path), config.protectedFiles);
}

export function approved(state, token) {
  // 有効期限内の一時承認があるか調べる。
  return (state.approvals || []).some((approval) => approval.pattern === token && !expired(approval.until, 0, now()));
}

export function relevantFiles(edit, config) {
  // フックで扱う CSS または保護ファイルだけを残す。
  return edit.files.filter((file) => isCssEdit(file, config) || isProtectedFile(file, config));
}

export function violations(edit, config, state) {
  // 編集前に拒否すべき規則違反をすべて集める。
  const files = relevantFiles(edit, config);

  if (!files.length) {
    return [];
  }

  const out = [];
  const at = now();

  for (const file of files) {
    const rel = relativePath(config.root, file.path);

    if (config.requireScope) {
      const scope = state.scope;
      const stale = !scope || expired(scope.at, config.scopeMaxAgeHours * 3600000, at);

      if (stale) {
        out.push('R1: Declare the scope with `css-guard begin --scope <glob>` before editing.');
      } else if (!matchesAny(rel, scope.patterns)) {
        out.push(`R1: ${rel} is outside the declared scope. Confirm with the user before expanding the scope.`);
      }
    }

    const measureExpired = !state.lastMeasureAt || expired(state.lastMeasureAt, config.measureMaxAgeMin * 60000, at);
    if (config.requireMeasure && measureExpired) {
      out.push(`R2: Run \`css-guard measure ...\` to measure the target and its parents before editing. Last measurement: ${timestamp(state.lastMeasureAt)}. Batch related changes, then remeasure the same target.`);
    }

    const selector = protectedSelector([...file.removed, ...file.added, ...blockSelectors(file)], config, state);

    if (selector) {
      out.push(`R4: ${selector} is a protected selector affecting multiple areas. After user approval, run \`css-guard approve ${selector}\`.`);
    }

    const addOverExistingFile = file.kind === 'add' && fs.existsSync(file.path);

    if (file.kind === 'write' || file.kind === 'delete' || addOverExistingFile) {
      out.push('R5: Patch only the parts required by the request; do not replace or delete the entire file.');
    }

    const protectedPattern = config.protectedFiles.find((pattern) => matchesAny(rel, [pattern]));
    const token = `file:${protectedPattern}`;

    if (isProtectedFile(file, config) && !approved(state, token)) {
      out.push(`R6: ${rel} is a protected file. After user approval, run \`css-guard approve ${token}\`.`);
    }
  }

  return [...new Set(out)];
}
