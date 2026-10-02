import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { documentHook, documentCommand, localPath } from '../lib/documents.mjs';

const installation = path.resolve(import.meta.dirname, '..');
const scripts = path.join(installation, await fs.access(path.join(installation, 'skill')).then(() => 'skill', () => 'skills/design-guard'), 'scripts');
function pdf(x = 50, reference = 50) {
  const stream = `BT /F1 12 Tf ${x} 240 Td (TARGET) Tj ET BT /F1 12 Tf ${reference} 180 Td (REFERENCE) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let data = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(data);
  return data + 'xref\n0 6\n0000000000 65535 f \n' + offsets.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
}
async function fixture(t, create = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-guard-document-hooks-'));
  const originalHome = process.env.DESIGN_GUARD_HOME;
  const originalSession = process.env.CODEX_SESSION_ID;
  process.env.DESIGN_GUARD_HOME = path.join(root, 'home'); process.env.CODEX_SESSION_ID = root;
  t.after(() => {
    if (originalHome === undefined) delete process.env.DESIGN_GUARD_HOME; else process.env.DESIGN_GUARD_HOME = originalHome;
    if (originalSession === undefined) delete process.env.CODEX_SESSION_ID; else process.env.CODEX_SESSION_ID = originalSession;
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { documents: { files: ['report.pdf', 'comparison.pdf'].map((file) => ({ path: file, before: `evidence/${file}-before.json`, after: `evidence/${file}-after.json`, comparisons: ['comparison'] })), sources: ['generate.py'] } };
  const write = (file, value) => fs.writeFile(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  await write('render-guard.json', config); await write('generate.py', '# source\n');
  if (!create) await write('report.pdf', pdf()); await write('comparison.pdf', pdf());
  await write('targets.json', [{ name: 'target', page: 1, roiPt: [35,40,150,80], background: [255,255,255] }, { name: 'comparison', page: 1, roiPt: [35,100,150,140], background: [255,255,255] }]);
  const input = (command = 'officecli set report.pdf /body --prop text=changed', cwd = root) => ({ cwd, session_id: root, tool_name: 'Bash', tool_input: { command } });
  const hook = (kind, command, cwd) => documentHook(kind, input(command, cwd));
  const command = (mode, args = []) => documentCommand(mode, ['--project', root, ...args]);
  const measure = async (label) => {
    const r = spawnSync('python3', [path.join(scripts, 'measure-pdf.py'), path.join(root, 'report.pdf'), '--targets', path.join(root, 'targets.json'), '--output', path.join(root, 'evidence'), '--label', label], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    await fs.copyFile(path.join(root, 'evidence', `${label}.json`), path.join(root, 'evidence', `report.pdf-${label}.json`));
    return JSON.parse(await fs.readFile(path.join(root, 'evidence', `${label}.json`), 'utf8'));
  };
  const review = async () => {
    const after = JSON.parse(await fs.readFile(path.join(root, 'evidence/report.pdf-after.json'), 'utf8'));
    await write('review.json', { documents: [{ path: 'report.pdf', sourceSha256: after.sourceSha256, images: after.images.map((i) => i.sha256), observations: ['Test attestation; image opening is a separate manual check.'] }] });
  };
  const begin = (...extra) => command('begin', ['--scope', 'report.pdf', 'generate.py', ...extra]);
  const verify = () => command('verify', ['--review', 'review.json']);
  return { root, config, write, input, hook, command, measure, review, begin, verify };
}
const denied = (result) => assert.equal(result?.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(result));
const blocked = (result) => assert.equal(result?.decision, 'block', JSON.stringify(result));

test('document routing rejects unconfigured writes and preserves unrelated commands/reads', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-guard-unconfigured-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const hook = (command) => documentHook('hook-bash', { cwd: root, tool_name: 'Bash', tool_input: { command } });
  for (const file of ['file.docx', 'file.pptx', 'file.pdf']) denied(await hook(`officecli set ${file} /body --prop text=hello`));
  assert.equal(await hook('cat file.pdf'), null);
  assert.equal(await hook('officecli get file.docx /body'), null);
  assert.equal(await hook('git add file.docx'), null);
  assert.equal(await hook('unzip -p file.docx word/document.xml'), null);
  denied(await hook('pdftotext input.pdf output.pdf'));
  assert.equal(await hook('cp template.docx backup.zip'), null);
  denied(await hook('cp template.docx output.docx'));
  denied(await hook('cat file.pdf && officecli set file.pdf /body --prop text=hello'));
  assert.equal(await hook("cat > test.mjs <<'JS'\nconst file = path.join(root,'report.pdf');\nJS"), null);
  denied(await hook("cat >file.pdf <<'DATA'\ncontent\nDATA"));
  denied(await hook(`python3 arbitrary.py ${path.join(scripts, 'measure-pdf.py')} file.pdf`));
  assert.equal(await hook('python3 -c "print(1)"'), null);
  assert.equal(localPath('C:\\project\\file.pdf'), '/mnt/c/project/file.pdf');
  assert.equal(localPath('\\\\wsl.localhost\\Ubuntu\\home\\person\\file.pdf'), '/home/person/file.pdf');
});

test('real PDF batch must measure and review latest output before completion', async (t) => {
  const f = await fixture(t);
  await f.measure('before'); await f.begin();
  assert.equal(await f.hook('hook-bash'), null);
  assert.equal(await f.hook('hook-bash'), null);
  await f.write('report.pdf', pdf(68)); await f.hook('hook-post');
  blocked(await f.hook('hook-stop'));
  await assert.rejects(f.begin(), /Unverified/);
  await f.measure('after');
  await assert.rejects(f.command('verify'), /review/);
  await f.review(); assert.equal((await f.verify()).evidenceChecksPassed, true);
  assert.equal(await f.hook('hook-stop'), null);
  denied(await f.hook('hook-bash'));
  await f.write('report.pdf', pdf(69)); blocked(await f.hook('hook-stop'));
});

test('out-of-scope edits and replacement baselines cannot conceal comparison movement', async (t) => {
  const f = await fixture(t); await f.measure('before'); await f.begin();
  denied(await f.hook('hook-bash', 'officecli set comparison.pdf /body --prop text=hello'));
  await f.write('report.pdf', pdf(68, 70)); await f.hook('hook-post');
  const after = await f.measure('after'); await f.review();
  const fake = { ...after, measurementId: 'fake', measuredAt: new Date(Date.parse(after.measuredAt) - 1).toISOString() };
  await f.write('evidence/report.pdf-before.json', fake);
  await assert.rejects(f.verify(), /moved|Comparison changed/);
  blocked(await f.hook('hook-stop'));
});

test('after evidence must follow generation-source edits and cannot reuse modified pixels', async (t) => {
  const f = await fixture(t); await f.measure('before'); await f.begin();
  await f.write('report.pdf', pdf(68)); await f.hook('hook-post'); await f.measure('after'); await f.review();
  await f.write('generate.py', '# updated generator\n'); await f.hook('hook-post');
  await assert.rejects(f.verify(), /latest edit/);
  await f.measure('after'); await f.review(); await f.verify();
  await f.write('generate.py', '# changed again\n'); blocked(await f.hook('hook-stop'));
  const after = JSON.parse(await fs.readFile(path.join(f.root, 'evidence/report.pdf-after.json')));
  await fs.writeFile(after.images[0].path, 'changed image');
  await assert.rejects(f.verify(), /latest|image|observation/i);
});

test('creation uses explicit new output mode without pretending to have a before image', async (t) => {
  const f = await fixture(t, true);
  await assert.rejects(f.begin(), /--create/); await f.begin('--create');
  assert.equal(await f.hook('hook-bash'), null);
  await f.write('report.pdf', pdf()); await f.hook('hook-post');
  await f.measure('after'); await f.review(); await f.verify();
  assert.equal(await f.hook('hook-stop'), null);
});

test('unknown generator writes are caught at Stop and cannot be erased with begin', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.hook('hook-bash', 'python3 unknown.py'), null);
  await f.write('report.pdf', pdf(68)); await f.hook('hook-post');
  blocked(await f.hook('hook-stop'));
  await f.measure('before'); await assert.rejects(f.begin(), /before begin/);
});

test('configuration relaxation and removal cannot certify a pending batch', async (t) => {
  const f = await fixture(t); await f.measure('before'); await f.begin();
  f.config.documents.files[0].maxDrift = 100;
  await f.write('render-guard.json', f.config);
  await assert.rejects(f.verify(), /configuration/);
  blocked(await f.hook('hook-stop'));
  await f.write('render-guard.json', {});
  blocked(await f.hook('hook-stop', undefined, os.tmpdir()));
});

test('shared CLI routes canonical Bash and emits a supported denial response', async (t) => {
  const f = await fixture(t);
  const r = spawnSync(process.execPath, [path.join(installation, 'bin/render-guard.mjs'), 'hook-bash'], { input: JSON.stringify(f.input()), cwd: f.root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); denied(JSON.parse(r.stdout));
  const post = spawnSync(process.execPath, [path.join(installation, 'bin/render-guard.mjs'), 'hook-post'], { input: JSON.stringify(f.input()), cwd: f.root, encoding: 'utf8' });
  assert.equal(post.status, 0, post.stderr);
});

test('file editing tools must obey the same document-generation scope', async (t) => {
  const f = await fixture(t);
  const input = { cwd: f.root, session_id: f.root, tool_name: 'Write', tool_input: { file_path: path.join(f.root, 'generate.py'), content: '# changed' } };
  denied(await documentHook('hook-pre', input));
  await f.measure('before'); await f.begin();
  assert.equal(await documentHook('hook-pre', input), null);
  const outside = { ...input, tool_input: { ...input.tool_input, file_path: path.join(f.root, 'comparison.pdf') } };
  denied(await documentHook('hook-pre', outside));
});

test('an unrelated completed task leaves no stale watch and setup may add an output', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.hook('hook-bash', 'node --version'), null);
  assert.equal(await f.hook('hook-stop'), null);
  assert.equal(await fs.access(path.join(f.root, '.render-guard/documents/watch.json')).then(() => true, () => false), false);
  assert.equal(await f.hook('hook-bash', 'node --version'), null);
  f.config.documents.files.push({ path: 'new.pdf', before: 'evidence/new-before.json', after: 'evidence/new-after.json', comparisons: ['comparison'] });
  await f.write('render-guard.json', f.config);
  assert.equal((await f.command('begin', ['--scope', 'new.pdf', '--create'])).status, 'begun');
});
