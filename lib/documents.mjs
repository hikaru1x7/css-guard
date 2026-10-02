// Document hooks perform file/evidence checks only; never launch a renderer.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEdit } from './edits.mjs';
import { tokenize } from './delegate.mjs';

const installation = path.resolve(import.meta.dirname, '..');
const skill = path.join(installation, 'skills/design-guard');
const verifier = path.join(installation, 'skill/scripts/verify-documents.py');
const verifierPath = async () => await exists(verifier) ? verifier : path.join(skill, 'scripts/verify-documents.py');
const extensions = /\.(docx|pptx|pdf)$/i;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const digest = async (file) => sha(await fs.readFile(file));
const exists = async (file) => { try { await fs.access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const read = async (file) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const statePath = (root) => path.join(root, '.render-guard/documents/state.json');
const watchPath = (root) => path.join(root, '.render-guard/documents/watch.json');
const native = (file) => ({ '.docx': 'Microsoft Word', '.pptx': 'Microsoft PowerPoint' })[path.extname(file).toLowerCase()];
export function localPath(value) {
  const wsl = value.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+\\(.*)$/i);
  if (wsl) return '/' + wsl[1].replaceAll('\\', '/');
  return process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(value)
    ? '/mnt/' + value[0].toLowerCase() + '/' + value.slice(3).replaceAll('\\', '/') : value;
}
async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID();
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, file);
}
function inside(root, value) {
  if (typeof value !== 'string' || !value) throw new Error('Document paths must be nonempty relative paths.');
  const target = path.resolve(root, value);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Document paths must stay within the project.');
  return target;
}
export async function findDocuments(start) {
  let directory = path.resolve(start);
  while (true) {
    const file = path.join(directory, 'render-guard.json');
    if (await exists(file)) {
      const data = await read(file);
      if (data.documents !== undefined) return loadDocuments(directory, data.documents);
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
async function loadDocuments(root, given) {
  if (!given || !Array.isArray(given.files) || !given.files.length) throw new Error('documents.files must list the document outputs.');
  if (given.sources !== undefined && !Array.isArray(given.sources)) throw new Error('documents.sources must be an array.');
  if (!Number.isFinite(given.measureMaxAgeMin ?? 20) || (given.measureMaxAgeMin ?? 20) <= 0) throw new Error('measureMaxAgeMin must be positive and finite.');
  const files = given.files.map((entry) => {
    if (!entry || !extensions.test(entry.path || '') || !Array.isArray(entry.comparisons) || !entry.comparisons.length || entry.comparisons.some((n) => typeof n !== 'string' || !n)) throw new Error('Each document requires path, before, after and comparison names.');
    if (new Set(entry.comparisons).size !== entry.comparisons.length) throw new Error('Comparison names must be unique.');
    if (entry.maxDrift !== undefined && (!Number.isFinite(entry.maxDrift) || entry.maxDrift < 0)) throw new Error('maxDrift must be nonnegative and finite.');
    if (entry.allowPageCountChange !== undefined && typeof entry.allowPageCountChange !== 'boolean') throw new Error('allowPageCountChange must be boolean.');
    return { ...entry, file: inside(root, entry.path), beforeFile: inside(root, entry.before), afterFile: inside(root, entry.after) };
  });
  const sources = (given.sources || []).map((s) => inside(root, s));
  const all = files.map((f) => f.file).concat(sources);
  if (new Set(all).size !== all.length) throw new Error('Document outputs and generation sources must be distinct.');
  for (const f of files) if (all.includes(f.beforeFile) || all.includes(f.afterFile) || f.beforeFile === f.afterFile) throw new Error('Evidence cannot overwrite source files or share before/after paths.');
  const evidence = files.flatMap((f) => [f.beforeFile, f.afterFile]);
  if (new Set(evidence).size !== evidence.length) throw new Error('Each document needs separate evidence paths.');
  return { root, files, sources, all, configHash: sha(JSON.stringify(given)), maxAge: given.measureMaxAgeMin ?? 20 };
}
async function hashes(files) {
  const values = {};
  for (const file of files) values[file] = await exists(file) ? await digest(file) : null;
  return values;
}
async function stamps(files) {
  const values = {};
  for (const file of files) {
    try { const s = await fs.stat(file, { bigint: true }); values[file] = [String(s.size), String(s.mtimeNs), String(s.ctimeNs)]; }
    catch (e) { if (e.code !== 'ENOENT') throw e; values[file] = null; }
  }
  return values;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function evidence(entry, label, cfg) {
  const record = await read(label === 'before' ? entry.beforeFile : entry.afterFile);
  const expected = native(entry.file);
  if (expected ? record.renderer !== expected : !/^pdftoppm version\b/.test(record.renderer || '')) throw new Error('Use the intended native renderer: ' + entry.path);
  if (!record.version || !record.measurementId || !Number.isInteger(record.pageCount) || record.pageCount < 1) throw new Error('Incomplete renderer/version/page evidence: ' + entry.path);
  if (path.resolve(localPath(record.source || '')) !== entry.file || record.sourceSha256 !== await digest(entry.file)) throw new Error('Evidence does not match current source: ' + entry.path);
  const at = Date.parse(record.measuredAt);
  if (!Number.isFinite(at) || at > Date.now() + 5000 || Date.now() - at > cfg.maxAge * 60000) throw new Error('Fresh document measurement required: ' + entry.path);
  if (!Array.isArray(record.targets) || record.targets.length < 2 || new Set(record.targets.map((t) => t.name)).size !== record.targets.length || !Array.isArray(record.images) || !record.images.length) throw new Error('Actual targets, comparisons and images required.');
  for (const name of entry.comparisons) if (!record.targets.some((t) => t.name === name)) throw new Error('Missing comparison: ' + name);
  if (entry.comparisons.length === record.targets.length) throw new Error('Declare at least one requested target separately from comparisons.');
  for (const image of record.images) if (await digest(localPath(image.path)) !== image.sha256) throw new Error('Evidence image modified: ' + entry.path);
  return record;
}
async function link(cfg, input = {}) {
  const id = input.session_id || process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID;
  if (!id) return;
  const file = indexPath(id);
  const roots = await exists(file) ? await read(file) : [];
  if (!roots.includes(cfg.root)) await write(file, roots.concat(cfg.root));
}
function indexPath(id) {
  return path.join(process.env.DESIGN_GUARD_HOME || path.join(os.homedir(), '.local/state/design-guard'), 'documents/sessions', sha(String(id)) + '.json');
}
async function state(cfg) { return await exists(statePath(cfg.root)) ? await read(statePath(cfg.root)) : null; }
async function unchangedReceipt(cfg, current) {
  if (!current?.receipt || current.configHash !== cfg.configHash) return false;
  if (!same(await hashes(cfg.all), current.receipt.sources)) return false;
  if (await digest(await verifierPath()) !== current.verifierHash) return false;
  return same(await stamps(Object.keys(current.receipt.artifacts)), current.receipt.artifacts);
}
function assertConfig(cfg, current) {
  if (!current || current.configHash !== cfg.configHash) throw new Error('Run render-guard documents begin with the current document configuration.');
}
export async function documentCommand(command, args) {
  const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const cfg = await findDocuments(option('--project') || process.cwd());
  if (!cfg) throw new Error('Add a documents section to render-guard.json first.');
  const current = await state(cfg);
  if (command === 'status') return current || { status: 'not-started' };
  if (command === 'begin') {
    if (current && !await unchangedReceipt(cfg, current)) throw new Error('Unverified document work exists. Do not erase its baseline by restarting begin.');
    if (await exists(watchPath(cfg.root))) {
      const watch = await read(watchPath(cfg.root));
      if (!same(watch.sources, await hashes(Object.keys(watch.sources)))) throw new Error('A document/source changed before begin. Restore that change rather than replacing the baseline.');
    }
    const at = args.indexOf('--scope');
    const rest = at < 0 ? [] : args.slice(at + 1);
    const end = rest.findIndex((a) => a.startsWith('--'));
    const scope = end < 0 ? rest : rest.slice(0, end);
    if (!scope.length) throw new Error('Declare --scope document paths and generation sources.');
    const selected = scope.map((s) => inside(cfg.root, s));
    if (selected.some((s) => !cfg.all.includes(s))) throw new Error('Scope includes unconfigured document/source files.');
    const outputs = cfg.files.filter((f) => selected.includes(f.file));
    if (!outputs.length) throw new Error('Scope must declare affected document outputs.');
    const sourceHashes = await hashes(cfg.all);
    const baseline = {};
    for (const entry of outputs) {
      if (sourceHashes[entry.file] === null) {
        if (!args.includes('--create')) throw new Error('Missing output needs explicit --create: ' + entry.path);
        baseline[entry.file] = null;
      } else baseline[entry.file] = await evidence(entry, 'before', cfg);
    }
    const next = { id: randomUUID(), startedAt: new Date().toISOString(), configHash: cfg.configHash, verifierHash: await digest(await verifierPath()), scope: selected, sources: sourceHashes, observed: await stamps(cfg.all), baseline };
    await write(statePath(cfg.root), next); await link(cfg); return { status: 'begun', scope };
  }
  assertConfig(cfg, current);
  if (command !== 'verify') throw new Error('Document commands: begin, verify, status.');
  const reviewPath = option('--review');
  if (!reviewPath) throw new Error('Provide --review <visual-review.json> after opening actual images.');
  const review = await read(path.resolve(cfg.root, reviewPath));
  const initial = await hashes(cfg.all);
  if (!same(current.observed, await stamps(cfg.all))) {
    current.editedAt = new Date().toISOString(); current.observed = await stamps(cfg.all);
    await write(statePath(cfg.root), current);
    throw new Error('Source changed since the last observation. Measure after the latest edits and retry verification.');
  }
  for (const file of cfg.all) if (!current.scope.includes(file) && current.sources[file] !== initial[file]) throw new Error('Out-of-scope document/source changed: ' + file);
  if (await digest(await verifierPath()) !== current.verifierHash) throw new Error('Document verifier changed during comparison.');
  const artifacts = [path.resolve(cfg.root, reviewPath)];
  for (const entry of cfg.files.filter((f) => Object.hasOwn(current.baseline, f.file))) {
    const after = await evidence(entry, 'after', cfg);
    if (Date.parse(after.measuredAt) < Date.parse(current.editedAt || current.startedAt)) throw new Error('After evidence predates the latest edit in this batch.');
    const reviewed = review.documents?.find((r) => r.path === entry.path);
    if (!reviewed || reviewed.sourceSha256 !== after.sourceSha256 || !Array.isArray(reviewed.observations) || !reviewed.observations.length || reviewed.observations.some((o) => typeof o !== 'string' || !o.trim()) || !Array.isArray(reviewed.images) || !after.images.every((image) => reviewed.images.includes(image.sha256))) throw new Error('Fresh visual review of all measured images required: ' + entry.path);
    const before = current.baseline[entry.file];
    let beforePath;
    if (before) {
      // Pass the retained baseline, not an editable replacement before.json.
      beforePath = path.join(cfg.root, '.render-guard/documents', 'baseline-' + current.id + '-' + sha(entry.file) + '.json');
      await write(beforePath, before);
    }
    const verifyArgs = [await verifierPath(), '--source', entry.file, '--after', entry.afterFile];
    if (before) verifyArgs.push('--before', beforePath); else verifyArgs.push('--new');
    for (const name of entry.comparisons) verifyArgs.push('--comparison', name);
    // Exceptional tolerances/page-count changes are pinned in the original configuration.
    if (entry.maxDrift !== undefined) verifyArgs.push('--max-drift', String(entry.maxDrift));
    if (entry.allowPageCountChange === true) verifyArgs.push('--allow-page-count-change');
    await runVerifier(verifyArgs);
    artifacts.push(entry.afterFile, ...after.images.map((i) => localPath(i.path)), ...(before ? before.images.map((i) => localPath(i.path)) : []));
    if (beforePath) await fs.rm(beforePath);
  }
  if (!same(initial, await hashes(cfg.all))) throw new Error('Source changed during document verification.');
  current.receipt = { sources: initial, artifacts: await stamps(artifacts), verifiedAt: new Date().toISOString() };
  await write(statePath(cfg.root), current); await fs.rm(watchPath(cfg.root), { force: true }); await link(cfg);
  return { evidenceChecksPassed: true, visualReviewAttestationRecorded: true };
}
function runVerifier(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.RENDER_GUARD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = ''; child.stderr.on('data', (d) => { error += d; });
    child.stdout.resume(); child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || 'Document verification failed.')));
  });
}
function commandParts(command) {
  // Here-document bodies are data, not shell arguments. Keep the header so
  // an actual output redirection still participates in document detection.
  const lines = command.split('\n');
  const executable = [];
  let delimiters = [];
  for (const line of lines) {
    if (delimiters.length) {
      if (line.replace(/^\t+/, '') === delimiters[0]) delimiters.shift();
      continue;
    }
    executable.push(line);
    for (const match of line.matchAll(/<<-?\s*(?:'([^']+)'|"([^"]+)"|([\w-]+))/g)) delimiters.push(match[1] || match[2] || match[3]);
  }
  const parts = [[]];
  for (const token of tokenize(executable.join('\n'))) { if (token.sep) parts.push([]); else parts.at(-1).push(token.word); }
  return parts.filter((p) => p.length);
}
function safeRead(command) {
  const parts = commandParts(command);
  return parts.length === 1 && !/[<>`]|\$\(/.test(command) && (
    ['cat', 'ls', 'stat', 'file', 'pdfinfo', 'rg', 'grep', 'head', 'tail', 'wc', 'sha256sum', 'md5sum'].includes(path.basename(parts[0][0] || '')) ||
    (path.basename(parts[0][0] || '') === 'git' && ['add', 'commit', 'status', 'diff', 'show', 'log', 'ls-files', 'check-ignore'].includes(parts[0][1])) ||
    (path.basename(parts[0][0] || '') === 'unzip' && parts[0].includes('-p')) ||
    (path.basename(parts[0][0] || '') === 'pdftotext' && (parts[0].at(-1) === '-' || parts[0].filter((w) => !w.startsWith('-')).length === 2)) ||
    (path.basename(parts[0][0] || '') === 'officecli' && ['get', 'view', 'info', 'query', 'tree', 'validate'].includes(parts[0][1])) ||
    ((/^(python(?:3)?(?:\.exe)?|powershell(?:\.exe)?)$/i.test(path.basename(parts[0][0] || ''))) && (() => {
      const words = parts[0];
      const at = /^powershell/i.test(path.basename(words[0])) ? words.findIndex((w) => w.toLowerCase() === '-file') + 1 : 1;
      if (at < 1 || !words[at]) return false;
      return [verifier, path.join(skill, 'scripts/verify-documents.py'), path.join(installation, 'skill/scripts/measure-pdf.py'), path.join(skill, 'scripts/measure-pdf.py'), path.join(installation, 'skill/scripts/measure-office.ps1'), path.join(skill, 'scripts/measure-office.ps1')].includes(path.resolve(localPath(words[at])));
    })()) ||
    (['render-guard', 'render-guard.mjs'].includes(path.basename(parts[0][0] || '')) && parts[0][1] === 'documents' && ['begin', 'verify', 'status'].includes(parts[0][2])) ||
    (parts[0][0] === 'node' && path.resolve(parts[0][1] || '') === path.join(installation, 'bin/render-guard.mjs') && parts[0][2] === 'documents' && ['begin', 'verify', 'status'].includes(parts[0][3]))
  );
}
function mentionedDocuments(command, cwd) {
  const paths = commandParts(command).flatMap((words) => path.basename(words[0] || '') === 'cp' && !words.includes('-t') && !words.some((w) => w.startsWith('--target-directory')) ? [words.at(-1)] : words).map((word) => word.replace(/^\d*[<>]+/, '')).filter((word) => extensions.test(word) && !word.includes('\n')).map((word) => path.resolve(cwd, localPath(word)));
  return [...new Set(paths)];
}
const block = (kind, error) => kind === 'hook-pre' || kind === 'hook-bash'
  ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'DesignGuard documents: ' + error.message } }
  : { decision: 'block', reason: 'DesignGuard documents: ' + error.message };
export async function documentHook(kind, input) {
  try {
    const cwd = path.resolve(input.cwd || process.cwd());
    const edit = kind === 'hook-pre' || kind === 'hook-post' ? await parseEdit(input) : { files: [] };
    const configs = new Map();
    const add = async (directory) => { const cfg = await findDocuments(directory); if (cfg) configs.set(cfg.root, cfg); };
    await add(cwd);
    for (const file of edit.files) await add(path.dirname(file.path));
    const bash = input.tool_name === 'Bash';
    const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
    const mentioned = bash ? mentionedDocuments(command, cwd) : edit.files.filter((f) => extensions.test(f.path)).map((f) => f.path);
    for (const file of mentioned) await add(path.dirname(file));
    const reading = bash && safeRead(command);
    if (kind === 'hook-bash' || kind === 'hook-pre') {
      if (!reading) for (const file of mentioned) {
        if (![...configs.values()].some((c) => c.files.some((f) => f.file === file))) throw new Error('Configure this document and measure before editing: ' + file);
      }
    }
    if (kind === 'hook-stop') {
      const id = input.session_id || process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID;
      if (id && await exists(indexPath(id))) for (const root of await read(indexPath(id))) {
        const cfg = await findDocuments(root);
        if (!cfg && (await exists(statePath(root)) || await exists(watchPath(root)))) throw new Error('Document configuration removed during tracked work: ' + root);
        if (cfg) configs.set(cfg.root, cfg);
      }
    }
    for (const cfg of configs.values()) {
      const current = await state(cfg);
      if (kind === 'hook-stop') {
        const watch = await exists(watchPath(cfg.root)) ? await read(watchPath(cfg.root)) : null;
        if (watch && !current && !same(watch.sources, await hashes(Object.keys(watch.sources)))) throw new Error('A document changed without a measured baseline: ' + cfg.root);
        if (current && !await unchangedReceipt(cfg, current)) throw new Error('Current document verification and visual review required: ' + cfg.root);
        await fs.rm(watchPath(cfg.root), { force: true });
        continue;
      }
      if (kind === 'hook-post') {
        if (current) {
          const observed = await stamps(cfg.all);
          if (!same(current.observed, observed)) {
            current.observed = observed; current.editedAt = new Date().toISOString();
            await write(statePath(cfg.root), current);
          }
        }
        await link(cfg, input); continue;
      }
      const affected = reading ? [] : [...edit.files.filter((f) => cfg.all.includes(f.path)).map((f) => f.path), ...mentioned.filter((f) => cfg.all.includes(f)), ...cfg.sources.filter((f) => commandParts(command).flat().some((w) => path.resolve(cwd, w) === f))];
      if (affected.length) {
        assertConfig(cfg, current);
        if (await unchangedReceipt(cfg, current)) throw new Error('Previous batch finished; measure and begin the next requested revision.');
        if (Date.now() - Date.parse(current.startedAt) > 6 * 3600000) throw new Error('Document scope expired. Preserve pending work and obtain fresh evidence.');
        for (const file of affected) if (!current.scope.includes(file)) throw new Error('Out-of-scope document/source edit: ' + file);
        for (const file of edit.files) if (affected.includes(file.path) && (file.kind === 'delete' || file.moveTo)) throw new Error('Deleting/moving a measured document or generation source requires a separate requested workflow.');
      }
      if (bash && !await exists(watchPath(cfg.root))) await write(watchPath(cfg.root), { sources: await hashes(cfg.all) });
      await link(cfg, input);
    }
    return null;
  } catch (error) { return block(kind, error); }
}
