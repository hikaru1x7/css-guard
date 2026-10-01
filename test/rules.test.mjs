import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaults } from '../lib/config.mjs';
import { violations } from '../lib/rules.mjs';

const root = '/tmp/css-guard-rules'; const config = { ...defaults, root, protectedSelectors: ['.btn'], protectedFiles: ['css/tokens.css'], maxRemovedLines: 2 };
const state = { scope: { patterns: ['css/*.css'], at: new Date().toISOString() }, lastMeasureAt: new Date().toISOString(), lastCssEditAt: null, approvals: [] };
const edit = (file = 'css/a.css', added = ['.box { color: red; }'], removed = [], kind = 'edit') => ({ files: [{ path: path.join(root, file), added, removed, kind }] });
test('実測なし・期限切れ・範囲外は拒否し、実測済みなら関連編集を続けられる', () => {
  const earlier = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(violations(edit(), config, { ...state, lastMeasureAt: earlier, lastCssEditAt: state.lastMeasureAt }), []);
  assert.ok(violations(edit(), config, { ...state, lastMeasureAt: null }).some(v => v.startsWith('R2')));
  assert.ok(violations(edit(), config, { ...state, lastMeasureAt: new Date(0).toISOString() }).some(v => v.startsWith('R2')));
  assert.ok(violations(edit('outside.css'), config, state).some(v => v.startsWith('R1')));
});
test('R1 範囲、R2 実測、R4 保護セレクタ、R5 丸ごと、R6 保護ファイルを拒否する', () => {
  assert.match(violations(edit(), config, { ...state, scope: null })[0], /R1/);
  assert.match(violations(edit(), config, { ...state, lastMeasureAt: null })[0], /R2/);
  assert.deepEqual(violations(edit('css/a.css', ['x !important']), config, state), []);
  assert.ok(violations(edit('css/a.css', ['.btn:hover { }']), config, state).some((value) => value.startsWith('R4')));
  assert.ok(!violations(edit('css/a.css', ['.btn-group { }']), config, state).some((value) => value.startsWith('R4')));
  assert.deepEqual(violations(edit('css/a.css', [], ['1', '2', '3']), config, state), []);
  assert.ok(violations(edit('css/tokens.css'), config, state).some((value) => value.startsWith('R6')));
});
test('important の移動と有効な承認を通す', () => {
  assert.ok(!violations(edit('css/a.css', ['x !important'], ['x !important']), config, state).some((value) => value.startsWith('R3')));
  const approved = { ...state, approvals: [{ pattern: '.btn', until: new Date(Date.now() + 60000).toISOString() }, { pattern: 'file:css/tokens.css', until: new Date(Date.now() + 60000).toISOString() }] };
  assert.ok(!violations(edit('css/a.css', ['.btn { }']), config, approved).some((value) => value.startsWith('R4')));
  assert.ok(!violations(edit('css/tokens.css'), config, approved).some((value) => value.startsWith('R6')));
  const expired = { ...approved, approvals: [{ pattern: '.btn', until: new Date(Date.now() - 1).toISOString() }] }; assert.ok(violations(edit('css/a.css', ['.btn { }']), config, expired).some((value) => value.startsWith('R4')));
});

test('R5 は delete と既存ファイルへの add を拒否する', () => {
  fs.mkdirSync(path.join(root, 'css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'css/a.css'), '.box {}\n');
  assert.deepEqual(violations(edit('css/a.css', ['x ! important; y !important;'], ['/* !important */']), config, state), []);
  assert.ok(!violations(edit('css/a.css', ['/* !important */'], []), config, state).some((value) => value.startsWith('R3')));
  assert.ok(violations(edit('css/a.css', [], [], 'delete'), config, state).some((value) => value.startsWith('R5')));
  assert.ok(violations(edit('css/a.css', [], [], 'add'), config, state).some((value) => value.startsWith('R5')));
});
