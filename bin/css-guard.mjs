#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../lib/config.mjs';
import { readState, resetState, updateState } from '../lib/state.mjs';
import { runHook } from '../lib/hooks.mjs';
import { packetText, verifyState } from '../lib/delegate.mjs';

const hookInvocation = /^hook-/.test(process.argv[2] || '');

// 旧セッションは開始時のフック登録を保持する。フック内部の診断失敗を
// Codex 自体の「Hook failed」に変換しないよう、フック呼出しだけは必ず exit 0 にする。
if (hookInvocation) {
  process.on('exit', () => {
    process.exitCode = 0;
  });
}

function args(values) {
  // 引数列を位置引数と --名前 形式の指定へ分ける。
  const flags = {};
  const positional = [];

  for (let index = 0; index < values.length; index++) {
    const value = values[index];

    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }

    const key = value.slice(2);
    const list = ['scope', 'routes'].includes(key);

    if (list) {
      const entries = [];

      while (index + 1 < values.length && !values[index + 1].startsWith('--')) {
        entries.push(values[++index]);
      }

      flags[key] = entries;
    } else if (index + 1 < values.length && !values[index + 1].startsWith('--')) {
      flags[key] = values[++index];
    } else {
      flags[key] = true;
    }
  }

  return { flags, positional };
}

function widths(value, fallback) {
  // カンマ区切りの画面幅を数値配列にする。
  return value ? String(value).split(',').map((item) => Number(item)).filter(Number.isFinite) : fallback;
}

function routes(value, fallback) {
  // routes 指定を一つの配列に正規化する。
  if (!value) {
    return fallback;
  }

  return (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(',')).filter(Boolean);
}

function jsonOutput(value) {
  // 機械向け JSON を標準出力へ書く。
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function hookInput() {
  // フックの標準入力を文字列のまま読み、runHook 内で解釈させる。
  let data = '';

  for await (const chunk of process.stdin) {
    data += chunk;
  }

  return () => data ? JSON.parse(data) : {};
}

async function withBase(config, staticOverride, callback, requiresBase = true) {
  // static 指定なら一時サーバを起動し、必要な場合だけ baseUrl を要求する。
  let baseUrl = config.baseUrl;
  let server;

  if (staticOverride || config.static) {
    const { serveStatic } = await import('../lib/browser.mjs');
    server = await serveStatic(path.resolve(config.root, staticOverride || config.static));
    baseUrl = server.baseUrl;
  }

  if (requiresBase && !baseUrl) {
    throw new Error('Set baseUrl or static in css-guard.json, or use --static');
  }

  try {
    return await callback(baseUrl);
  } finally {
    if (server) {
      await server.close();
    }
  }
}

function urlFor(value, baseUrl) {
  // 完全な URL は設定なしでそのまま使い、相対指定だけ baseUrl と結合する。
  return /^https?:\/\//.test(value) ? value : new URL(value, baseUrl).href;
}

function printTable(headers, rows) {
  // 短い固定幅の表を人向けに出力する。
  const values = [headers, ...rows].map((row) => row.map((value) => String(value)));
  const lengths = headers.map((_, index) => Math.max(...values.map((row) => row[index].length)));
  const line = (row) => row.map((value, index) => String(value).padEnd(lengths[index])).join(' | ');
  process.stdout.write(`${line(headers)}\n`);
  process.stdout.write(`${lengths.map((length) => '-'.repeat(length)).join('-|-')}\n`);

  for (const row of rows) {
    process.stdout.write(`${line(row)}\n`);
  }
}

async function printMeasure(result, config) {
  // 実測結果を位置と主要スタイル中心の短い表で表示する。
  printTable(['Viewport', 'x, y, width, height', 'Display', 'Width', 'Height', 'Padding', 'Gap', 'Settled'], result.widths.map((entry) => [
    entry.width,
    `${entry.target.rect.x}, ${entry.target.rect.y}, ${entry.target.rect.width}, ${entry.target.rect.height}`,
    entry.target.styles.display,
    entry.target.styles.width,
    entry.target.styles.height,
    `${entry.target.styles['padding-top']} ${entry.target.styles['padding-right']} ${entry.target.styles['padding-bottom']} ${entry.target.styles['padding-left']}`,
    entry.target.styles.gap,
    entry.settled ? 'yes' : 'continued after render'
  ]));

  if (result.previous?.changes?.length) {
    process.stdout.write('Changes since the previous measurement\n');
    printTable(['Viewport', 'Property', 'Before', 'After'], result.previous.changes.map((change) => [change.width, change.path, change.before, change.after]));
  }

  const state = await readState(config.root);
  process.stdout.write(`JSON: ${state.lastMeasure?.path || 'path unavailable'}\n`);
  const shots = result.widths.flatMap((entry) => [entry.elementShot, entry.screenshot]).filter(Boolean);

  if (shots.length) {
    process.stdout.write(`Screenshots: ${shots.join(' ')}\n`);
    process.stdout.write('Open the PNGs with your agent\'s image viewer (for example, view_image in Codex or Read in Claude). Judge the rendered result as well as the numbers.\n');
  }
}

function printSnap(result) {
  // 画面比較の結果としきい値超過を短い表で表示する。
  printTable(['Route', 'Viewport', 'Changed pixels', 'Over threshold'], result.entries.map((entry) => [
    entry.route,
    entry.width,
    entry.changedPixels ?? 'baseline created',
    entry.overThreshold === undefined ? '-' : entry.overThreshold ? 'yes' : 'no'
  ]));
}

function help() {
  // 利用できるサブコマンドを案内する。
  process.stdout.write('css-guard: begin, scope, measure, snap, approve, status, verify, packet, hook-pre, hook-post, hook-stop, hook-bash, doctor\n');
}

async function playwrightVersion() {
  // 導入済み package.json から Playwright の版を読む。
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.dependencies.playwright;
}

async function main() {
  // サブコマンドを解釈し、JSON 指定時以外は人向け表示にする。
  const command = process.argv[2];
  const { flags, positional } = args(process.argv.slice(3));

  if (!command || command === '--help' || command === '-h') {
    return help();
  }

  if (['hook-pre', 'hook-post', 'hook-stop', 'hook-bash'].includes(command)) {
    const result = await runHook(command, await hookInput());

    if (result) {
      jsonOutput(result);
    }

    return;
  }

  const config = await loadConfig(process.cwd());

  if (command === 'begin') {
    if (!flags.scope?.length) {
      throw new Error('begin requires --scope <glob>');
    }

    if (flags.snap && !routes(flags.routes, config.routes).length) {
      throw new Error('begin --snap requires routes in css-guard.json or --routes');
    }

    const state = await resetState(config.root, flags.scope);

    if (flags.snap) {
      const { snap } = await import('../lib/snap.mjs');
      await withBase(config, flags.static, (baseUrl) => snap({ config, baseUrl, routes: routes(flags.routes, config.routes) }));
    }

    return flags.json ? jsonOutput(state) : process.stdout.write('Scope declared.\n');
  }

  if (command === 'scope') {
    if (!positional.length) {
      throw new Error('scope requires a glob');
    }

    const state = await updateState(config.root, (value) => ({
      ...value,
      scope: { patterns: positional, at: new Date().toISOString() }
    }));
    return flags.json ? jsonOutput(state.scope) : process.stdout.write(`Scope: ${state.scope.patterns.join(', ')}\n`);
  }

  if (command === 'approve') {
    if (!positional[0]) {
      throw new Error('approve requires a selector or file:glob');
    }

    const minutes = Number(flags.minutes || 120);
    const approval = {
      pattern: positional[0],
      until: new Date(Date.now() + minutes * 60000).toISOString()
    };
    await updateState(config.root, (state) => ({
      ...state,
      approvals: [...(state.approvals || []).filter((item) => Date.parse(item.until) > Date.now()), approval]
    }));
    return flags.json ? jsonOutput(approval) : process.stdout.write(`Approved ${approval.pattern} until ${approval.until}.\n`);
  }

  if (command === 'status') {
    const value = { config: config.root, state: await readState(config.root) };
    return flags.json ? jsonOutput(value) : printTable(['Item', 'Value'], [
      ['Config', value.config],
      ['Scope', value.state.scope?.patterns?.join(', ') || 'not set'],
      ['Last measurement', value.state.lastMeasureAt || 'not measured'],
      ['Last edit', value.state.lastCssEditAt || 'no edits']
    ]);
  }

  if (command === 'verify') {
    const value = verifyState(config, await readState(config.root));

    if (flags.json) {
      jsonOutput(value);
    } else {
      printTable(['Item', 'Value'], [
        ['CSS edits', value.edits ? `${value.edits} (last: ${value.lastCssEditAt})` : 'none'],
        ['Last measurement', value.lastMeasureAt || 'not measured'],
        ['Last snapshot check', value.lastSnapCheckAt || 'not checked'],
        ['Result', value.ok ? 'passed' : value.problems.join(' / ')]
      ]);
    }

    process.exitCode = value.ok ? 0 : 1;
    return;
  }

  if (command === 'packet') {
    const text = packetText(config, await readState(config.root), {
      scope: flags.scope,
      url: typeof flags.url === 'string' ? flags.url : undefined,
      selector: typeof flags.selector === 'string' ? flags.selector : undefined
    });
    return flags.json ? jsonOutput({ root: config.root, text }) : process.stdout.write(text);
  }

  if (command === 'measure') {
    const [target, selector] = positional;

    if (!target || !selector) {
      throw new Error('measure requires <url|path> <selector>');
    }

    const { measure } = await import('../lib/measure.mjs');
    const requiresBase = !/^https?:\/\//.test(target);
    const result = await withBase(config, flags.static, (baseUrl) => measure({
      config,
      url: urlFor(target, baseUrl),
      selector,
      widths: widths(flags.widths, config.widths),
      parents: Number(flags.parents || 2),
      actions: flags.actions,
      label: flags.label,
      baseUrl,
      comparisonKey: target
    }), requiresBase);
    return flags.json ? jsonOutput(result) : printMeasure(result, config);
  }

  if (command === 'snap') {
    const { snap } = await import('../lib/snap.mjs');
    const result = await withBase(config, flags.static, (baseUrl) => snap({
      config,
      baseUrl,
      widths: widths(flags.widths, config.widths),
      routes: routes(flags.routes, config.routes),
      baseline: Boolean(flags.baseline)
    }));
    return flags.json ? jsonOutput(result) : printSnap(result);
  }

  if (command === 'doctor') {
    const { chromium } = await import('playwright');
    const executable = chromium.executablePath();
    let exists = false;
    let configExists = false;

    try {
      await fs.access(executable);
      exists = true;
    } catch {
      // 下の診断結果で未導入として表示する。
    }

    try {
      await fs.access(config.file);
      configExists = true;
    } catch {
      // 既定値だけでも診断は続ける。
    }

    const value = {
      node: process.version,
      playwright: await playwrightVersion(),
      chromium: { executable, available: exists },
      config: { file: config.file, exists: configExists, loaded: config }
    };
    return flags.json ? jsonOutput(value) : printTable(['Item', 'Value'], [
      ['Node', value.node],
      ['Playwright', value.playwright],
      ['Chromium', value.chromium.available ? 'available' : 'not installed'],
      ['Config', value.config.exists ? 'present' : 'defaults']
    ]);
  }

  help();
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`css-guard: ${error.message}\n`);
  process.exitCode = hookInvocation ? 0 : 1;
});
