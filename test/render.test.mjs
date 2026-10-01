import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cli, json, repo, tempProject, codexPatch } from './helpers.mjs';
import { sessionRecord, dayId } from '../lib/session-maintenance.mjs';
import { combineHooks } from '../lib/render-routing.mjs';

async function render(project, params, input = '') {
  const session = 'render-integration';
  const guiHome = path.join(project.home, 'gui');
  for (const file of [sessionRecord(dayId(), project.home), path.join(guiHome, 'maintenance', createHash('sha256').update(dayId()).digest('hex') + '.json')]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ status: 'current' }));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repo, 'bin/render-guard.mjs'), ...params], {
      cwd: project.root, env: { ...project.env, CODEX_SESSION_ID: session, GUI_GUARD_HOME: guiHome }, stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('unified CSS entry preserves measurement, cascade and the existing project state', async () => {
  const project = await tempProject({ widths: [375], routes: [] });
  const old = json(await cli(project, ['measure', '/index.html', '#b']));
  const unified = json(await render(project, ['css', 'measure', '/index.html', '#b', '--json']));
  assert.deepEqual(unified.widths[0].target, old.widths[0].target);
  assert.deepEqual(unified.widths[0].parents, old.widths[0].parents);
  const sources = (entries) => entries.map((entry) => ({ ...entry, source: entry.source.replace(/http:\/\/127\.0\.0\.1:\d+/, 'http://test-server') }));
  assert.deepEqual(sources(unified.widths[0].cascade), sources(old.widths[0].cascade));
  const status = json(await render(project, ['css', 'status', '--json']));
  assert.equal(status.state.lastMeasure.path.startsWith(project.home), true);
  assert.equal(unified.previous.changes.length, 0);
});

test('common hooks retain CSS before-edit and after-edit gates for both agents', async () => {
  const project = await tempProject({ widths: [375], routes: [] });
  const patch = { cwd: project.root, tool_name: 'apply_patch', tool_input: { command: codexPatch(path.join(project.root, 'css/a.css')) } };
  const invoke = (kind) => render(project, [kind], JSON.stringify(patch));
  assert.equal(json(await invoke('hook-pre')).hookSpecificOutput.permissionDecision, 'deny');
  json(await render(project, ['css', 'begin', '--scope', 'css/*.css', '--json']));
  json(await render(project, ['css', 'measure', '/index.html', '#b', '--label', 'before', '--json']));
  assert.equal((await invoke('hook-pre')).stdout, '');
  const claude = { ...patch, tool_name: 'Edit', tool_input: { file_path: path.join(project.root, 'css/a.css'), old_string: '.box{width:100px}', new_string: '.box{width:120px}' } };
  assert.equal((await render(project, ['hook-pre'], JSON.stringify(claude))).stdout, '');
  await invoke('hook-post');
  assert.equal(json(await invoke('hook-stop')).decision, 'block');
  assert.equal((await render(project, ['css', 'verify', '--json'])).code, 1);
  json(await render(project, ['css', 'measure', '/index.html', '#b', '--label', 'after', '--json']));
  assert.equal(json(await render(project, ['css', 'verify', '--json'])).ok, true);
});

test('SVG measures rendered geometry, text, stroke, and preserves a separate unchanged comparison', async () => {
  const project = await tempProject({ widths: [375], routes: [] });
  await fs.copyFile(path.join(repo, 'test/fixtures/svg/diagram.svg'), path.join(project.root, 'diagram.svg'));
  await fs.writeFile(path.join(project.root, 'render-guard.json'), JSON.stringify({ svg: { static: '.', widths: [375], comparisonSelectors: ['#comparison'] } }));
  json(await cli(project, ['measure', '/index.html', '#b']));
  const cssState = (await cli(project, ['status'])).stdout;
  json(await render(project, ['svg', 'begin', '--scope', 'diagram.svg', '--json']));
  const before = json(await render(project, ['svg', 'measure', '/diagram.svg', '#requested', '--label', 'before', '--json']));
  assert.equal(before.widths[0].target.svg.geometryBox.width, 80);
  assert.equal(before.widths[0].target.styles['stroke-width'], '2px');
  assert.equal(before.widths[0].comparisons[0].svg.text, 'Keep this');
  assert.ok(before.widths[0].comparisons[0].svg.renderedTextLength > 0);
  const payload = { cwd: project.root, tool_name: 'Edit', tool_input: { file_path: path.join(project.root, 'diagram.svg'), old_string: 'width="80"', new_string: 'width="100"' } };
  assert.equal((await render(project, ['hook-pre'], JSON.stringify(payload))).stdout, '');
  const source = await fs.readFile(path.join(project.root, 'diagram.svg'), 'utf8');
  await fs.writeFile(path.join(project.root, 'diagram.svg'), source.replace('width="80"', 'width="100"'));
  await render(project, ['hook-post'], JSON.stringify(payload));
  assert.equal((await render(project, ['svg', 'verify', '--json'])).code, 1);
  const after = json(await render(project, ['svg', 'measure', '/diagram.svg', '#requested', '--label', 'after', '--json']));
  assert.ok(after.previous.changes.some((change) => change.path === 'target.svg.geometryBox.width' && change.after === 100));
  assert.equal(json(await render(project, ['svg', 'verify', '--json'])).ok, true);
  assert.equal((await cli(project, ['status'])).stdout, cssState);
  await fs.writeFile(path.join(project.root, 'diagram.svg'), source.replace('width="80"', 'width="100"').replace('Keep this', 'Changed outside scope'));
  await render(project, ['hook-post'], JSON.stringify(payload));
  const denied = await render(project, ['svg', 'measure', '/diagram.svg', '#requested', '--label', 'after', '--json']);
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /comparison target changed/);
  assert.equal((await render(project, ['svg', 'verify', '--json'])).code, 1);
});

test('SVG refuses ambiguous/missing targets and changed comparison conditions', async () => {
  const project = await tempProject();
  await fs.copyFile(path.join(repo, 'test/fixtures/svg/diagram.svg'), path.join(project.root, 'diagram.svg'));
  const configure = (selectors) => fs.writeFile(path.join(project.root, 'render-guard.json'), JSON.stringify({ svg: { static: '.', widths: [375], comparisonSelectors: selectors } }));
  await configure(['#comparison']);
  json(await render(project, ['svg', 'begin', '--scope', 'diagram.svg', '--json']));
  assert.equal((await render(project, ['svg', 'measure', '/diagram.svg', 'svg > *', '--json'])).code, 1);
  json(await render(project, ['svg', 'measure', '/diagram.svg', '#requested', '--label', 'before', '--json']));
  const mismatch = await render(project, ['svg', 'measure', '/diagram.svg', '#requested', '--widths', '1280', '--label', 'after', '--json']);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stderr, /conditions changed/);
  await configure([]);
  assert.equal((await render(project, ['svg', 'measure', '/diagram.svg', '#requested', '--json'])).code, 1);
});

test('one engine failure never hides another engine rejection', () => {
  const result = combineHooks('hook-pre', [null, { decision: 'block', reason: 'SVG comparison missing' }, { hookSpecificOutput: { permissionDecisionReason: 'GUI runtime is stale' } }]);
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /SVG comparison missing/);
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /GUI runtime is stale/);
});

test('SVG stroke-only lines can be measured without a nonzero geometry height', async () => {
  const project = await tempProject();
  await fs.writeFile(path.join(project.root, 'line.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><line id="requested" x1="20" x2="100" y1="40" y2="40" stroke="black" stroke-width="4"/><text id="comparison" x="160" y="45">Unchanged</text></svg>');
  await fs.writeFile(path.join(project.root, 'render-guard.json'), JSON.stringify({ svg: { static: '.', widths: [375], comparisonSelectors: ['#comparison'] } }));
  json(await render(project, ['svg', 'begin', '--scope', 'line.svg', '--json']));
  const result = json(await render(project, ['svg', 'measure', '/line.svg', '#requested', '--label', 'before', '--json']));
  assert.equal(result.widths[0].target.svg.geometryBox.height, 0);
  assert.equal(result.widths[0].target.styles['stroke-width'], '4px');
  await fs.access(result.widths[0].elementShot);
});

test('CSS comparison rejects tool version changes without clearing pending edits', async () => {
  const project = await tempProject({ widths: [375], routes: [] });
  json(await render(project, ['css', 'begin', '--scope', 'css/*.css', '--json']));
  json(await render(project, ['css', 'measure', '/index.html', '#b', '--label', 'before', '--json']));
  const status = json(await render(project, ['css', 'status', '--json']));
  const file = status.state.lastMeasure.path;
  const baseline = JSON.parse(await fs.readFile(file, 'utf8'));
  baseline.toolchain.playwright = 'old-version';
  await fs.writeFile(file, JSON.stringify(baseline));
  const payload = { cwd: project.root, tool_name: 'Edit', tool_input: { file_path: path.join(project.root, 'css/a.css'), old_string: '100px', new_string: '120px' } };
  await render(project, ['hook-post'], JSON.stringify(payload));
  const result = await render(project, ['css', 'measure', '/index.html', '#b', '--label', 'after', '--json']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /tool versions changed/);
  assert.equal((await render(project, ['css', 'verify', '--json'])).code, 1);
});
