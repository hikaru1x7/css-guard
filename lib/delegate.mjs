import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.mjs';

// Claude が Codex に仕事を渡すときの「作法の段落」と、その有無を Claude 側で検査するフック。

const markerPattern = /<!--\s*css-guard packet v1 root=(.+?)\s*-->/;
const nonePattern = /<!--\s*css-guard:\s*none\s*-->/;
const binPath = path.resolve(import.meta.dirname, '../bin/css-guard.mjs');
const valueFlags = new Set(['-c', '--config', '--enable', '--disable', '-i', '--image', '-m', '--model', '-p', '--profile', '-s', '--sandbox', '-C', '--cd', '--add-dir', '--thread-source', '-o', '--output-last-message', '--local-provider', '--color', '--output-schema']);

export function marker(root) {
  // 段落の先頭に置く目印。フックはこれと作業する木を照合する。
  return `<!-- css-guard packet v1 root=${path.resolve(root)} -->`;
}

function quoteList(values, fallback) {
  // 設定の配列を人が読む 1 行にする。
  return values?.length ? values.join(', ') : fallback;
}

export function packetText(config, state, { scope, url, selector } = {}) {
  // プロジェクト設定と状態から、指示書に貼る css-guard の段落を作る。
  const root = path.resolve(config.root);
  const patterns = scope?.length ? scope : state?.scope?.patterns || [];
  const scopeLine = patterns.length
    ? `${patterns.join(', ')} (edits outside this scope are rejected; limit changes to the requested elements and properties)`
    : 'Not declared (run `css-guard begin --scope <glob>` before editing; edits outside the scope are rejected)';
  const screen = config.baseUrl
    ? `${config.baseUrl} (development server; if unavailable, report it before starting work)`
    : config.static
      ? `Static directory ${config.static} (served temporarily by css-guard)`
      : 'Not configured (pass a full URL to measure)';
  const beginScope = patterns.length ? patterns.map((item) => `"${item}"`).join(' ') : '"<file glob>"';
  const snapFlag = config.routes?.length ? ' --snap' : '';
  const target = `${url || '<page path>'} "${selector || '<selector>'}"`;

  return `${marker(root)}
## Visual and CSS workflow (css-guard)

- Working tree: ${root} (work in this tree, not a clone or a separate copy; this tree serves the measured page)
- Page: ${screen}
- Viewport widths: ${quoteList(config.widths, 'defaults')} (measure every listed width)
- Allowed files: ${scopeLine}
- Protected shared selectors: ${quoteList(config.protectedSelectors, 'none')} (change only within user-approved scope; do not ask again for approval already given)
- Protected files: ${quoteList(config.protectedFiles, 'none')}
- Comparison routes: ${quoteList(config.routes, 'none')} (compare with \`css-guard snap\`)
- Execution: use a writable sandbox (workspace-write); css-guard saves results in \`.css-guard/\`

Workflow (do not bypass hooks, make out-of-scope changes, or overwrite existing edits)
On the first applicable skill or hook use each day, run \`css-guard update\`. Reuse the daily result across tasks and projects; do not repeat network checks, installs, or tests. Keep tool versions fixed during before/after measurement.
1. Declare scope with \`css-guard begin --scope ${beginScope}${snapFlag}\`. Use scope for updates; do not rerun begin.
2. Run \`css-guard measure ${target} --label before\`; inspect rendered dimensions, parents, styles, and cascade, and open the PNGs with view_image / Read.
3. Batch related fixes, then run \`css-guard measure ${target} --label after\` on the same target, state, and widths. Inspect PNGs and diffs for out-of-scope effects${config.routes?.length ? "; also compare pages with css-guard snap" : ""}.
4. Briefly report key before/after values, out-of-scope effects, and anything unverified. If measurement fails, do not claim completion.

CLI fallback: node ${binPath} (use this if css-guard is not on PATH)
Full skill: ~/.agents/skills/render-guard/SKILL.md (Codex) / ~/.claude/skills/render-guard/SKILL.md (Claude)
`;
}

export function verifyState(config, state) {
  // Codex の報告を信じず、状態から「編集後に測り直したか」を確かめる。
  const problems = [];
  const edited = state.cssEdits?.length > 0 && state.lastCssEditAt;
  const before = (left, right) => {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    return !Number.isFinite(leftTime) || !Number.isFinite(rightTime) || leftTime < rightTime;
  };

  if (edited && (state.pendingMeasure || !state.lastMeasureAt || before(state.lastMeasureAt, state.lastCssEditAt))) {
    problems.push(`The same target, state, and viewport widths have not been remeasured after the CSS edit (last edit: ${state.lastCssEditAt}; last measurement: ${state.lastMeasureAt || 'not measured'})`);
  }

  if (edited && config.routes?.length && (!state.lastSnapCheckAt || before(state.lastSnapCheckAt, state.lastCssEditAt))) {
    problems.push('Other configured routes have not been checked with `css-guard snap`');
  }

  return {
    ok: problems.length === 0,
    edits: state.cssEdits?.length || 0,
    lastCssEditAt: state.lastCssEditAt,
    lastMeasureAt: state.lastMeasureAt,
    lastSnapCheckAt: state.lastSnapCheckAt,
    problems
  };
}

export function tokenize(command) {
  // シェルの引用符を解いて語に分け、区切り（; && || | 改行）は sep として残す。
  const tokens = [];
  let current = '';
  let has = false;
  let quoted = false;
  let quote = null;
  const push = () => {
    if (has) {
      tokens.push({ word: current, quoted });
    }

    current = '';
    has = false;
    quoted = false;
  };

  for (let index = 0; index < command.length; index++) {
    const ch = command[index];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '\\' && index + 1 < command.length) {
        current += command[++index];
      } else {
        current += ch;
      }

      continue;
    }

    if (ch === '\'' || ch === '"') {
      quote = ch;
      has = true;
      quoted = true;
    } else if (ch === '\\' && index + 1 < command.length) {
      if (command[index + 1] !== '\n') {
        current += command[index + 1];
        has = true;
      }

      index++;
    } else if (/\s/.test(ch)) {
      push();

      if (ch === '\n') {
        tokens.push({ sep: true });
      }
    } else if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      push();
      tokens.push({ sep: true });

      while (index + 1 < command.length && /[;|&]/.test(command[index + 1])) {
        index++;
      }
    } else {
      current += ch;
      has = true;
    }
  }

  push();
  return tokens;
}

function segments(tokens) {
  // 区切りごとの語の列に分ける。
  const out = [[]];

  for (const token of tokens) {
    if (token.sep) {
      out.push([]);
    } else {
      out.at(-1).push(token);
    }
  }

  return out.filter((segment) => segment.length);
}

function extractHeredocs(command) {
  // ヒアドキュメントの本文を取り出し、本文を除いた命令文を返す。
  const bodies = [];
  const pattern = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n\s*\2(?=\n|$)/g;
  const stripped = command.replace(pattern, (whole, _quote, _tag, body) => {
    bodies.push(body);
    return whole.slice(0, whole.indexOf('\n'));
  });
  return { bodies, stripped };
}

function expandHome(value) {
  // 先頭の ~ をホームに置き換える。
  return value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value;
}

export function parseCodexInvocation(command) {
  // 命令文から codex exec の起動場所・サンドボックス・指示書の在り処を読む。
  const { bodies, stripped } = extractHeredocs(command);
  const parts = segments(tokenize(stripped));
  let cwd = null;
  let found = null;

  for (const tokens of parts) {
    const words = tokens.map((token) => token.word);

    if (words[0] === 'cd' && words[1]) {
      cwd = expandHome(words[1]);
      continue;
    }

    const at = tokens.findIndex((token, index) => !token.quoted && path.basename(token.word) === 'codex' && words[index + 1] === 'exec');

    if (at >= 0) {
      found = tokens.slice(at + 2);
      break;
    }
  }

  if (!found) {
    return null;
  }

  const result = { cwd, cd: null, sandbox: null, stdinFile: null, prompts: [], heredocs: bodies };

  for (let index = 0; index < found.length; index++) {
    const { word, quoted } = found[index];
    const [flag, inlineValue] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    const value = () => (inlineValue !== undefined ? inlineValue : found[++index]?.word);

    if (!quoted && word === '<') {
      result.stdinFile = found[++index]?.word || null;
    } else if (!quoted && word.startsWith('<') && !word.startsWith('<<') && word.length > 1) {
      result.stdinFile = word.slice(1);
    } else if (!quoted && word.startsWith('<<')) {
      // ヒアドキュメントの本文は取り出し済み。
    } else if (flag === '--sandbox' || flag === '-s') {
      result.sandbox = value() || null;
    } else if (flag === '--cd' || flag === '-C') {
      result.cd = value() || null;
    } else if (word === '--dangerously-bypass-approvals-and-sandbox') {
      result.sandbox = 'danger-full-access';
    } else if (word === '--full-auto') {
      result.sandbox = 'workspace-write';
    } else if (valueFlags.has(flag)) {
      value();
    } else if (word === '-' || word.startsWith('-') || ['resume', 'fork', 'review', 'help'].includes(word) && index === 0) {
      // 標準入力の指定・値を持たない旗・副命令は読み飛ばす。
    } else {
      result.prompts.push(word);
    }
  }

  return result;
}

async function exists(file) {
  // ファイルの有無を返す。
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function realpath(target) {
  // 実体のパスに寄せる。無ければそのまま返す。
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

function deny(reason) {
  // Claude の PreToolUse 拒否形式。
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  };
}

export async function bashHook(input) {
  // Claude が codex exec を書き込みありで投げるとき、css-guard の段落と作業する木を検査する。
  if (input.tool_name !== 'Bash') {
    return null;
  }

  const command = String(input.tool_input?.command || '');

  if (!/\bcodex\s+exec\b/.test(command)) {
    return null;
  }

  const invocation = parseCodexInvocation(command);

  if (!invocation || invocation.sandbox === 'read-only') {
    return null;
  }

  const base = path.resolve(input.cwd || process.cwd(), invocation.cwd || '.');
  const target = path.resolve(base, expandHome(invocation.cd || '.'));
  const config = await loadConfig(target);

  if (!await exists(config.file)) {
    return null;
  }

  const texts = [...invocation.heredocs, ...invocation.prompts];

  if (invocation.stdinFile) {
    try {
      texts.push(await fs.readFile(path.resolve(base, expandHome(invocation.stdinFile)), 'utf8'));
    } catch {
      // 読めない指示書は「段落なし」として扱う。
    }
  }

  const text = texts.join('\n');
  const found = text.match(markerPattern);

  if (!found) {
    if (nonePattern.test(text)) {
      return null;
    }

    return deny(`The Codex write target (${config.root}) uses css-guard. For visual or CSS work, prepend the output of \`css-guard packet --scope <glob>\` to the task instructions. For non-visual work, include \`<!-- css-guard: none -->\` (Codex CSS checks still apply). For read-only work, use --sandbox read-only.`);
  }

  const declared = await realpath(path.resolve(found[1]));
  const actual = await realpath(config.root);

  if (declared !== actual) {
    return deny(`The working tree in the task instructions (${declared}) differs from the Codex working tree (${actual}). Work in the configured working tree that serves the measured page; editing a clone while measuring the original invalidates the comparison.`);
  }

  return null;
}
