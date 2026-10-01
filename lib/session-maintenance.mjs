import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { installedVersions, updateDependencies } from './maintenance.mjs';

export function sessionId(input = {}) {
  return input.session_id || process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID;
}

export function sessionRecord(session, home = process.env.CSS_GUARD_HOME || path.join(os.homedir(), '.cache/css-guard')) {
  return path.join(home, 'maintenance', createHash('sha256').update(String(session)).digest('hex') + '.json');
}

export async function latestVersions() {
  return Object.fromEntries(await Promise.all(['playwright', 'pixelmatch', 'pngjs'].map(async (name) => {
    const response = await fetch(`https://registry.npmjs.org/${name}/latest`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Stable-version check failed: ${name}`);
    return [name, (await response.json()).version];
  })));
}

export async function saveSession(session, value, home) {
  const file = sessionRecord(session, home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value));
  await fs.rename(temporary, file);
}

export async function checkSession(session, { home, latest = latestVersions, installed = installedVersions } = {}) {
  if (!session) return { status: 'unidentified' };
  const file = sessionRecord(session, home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = `${file}.lock`;
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { status: 'checking' };
  }
  try {
    const cached = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.rmdir(lock);
    return cached;
  } catch (error) { if (error.code !== 'ENOENT') { await fs.rmdir(lock); throw error; } }
  await saveSession(session, { status: 'checking' }, home);
  let result;
  try {
    const [available, current] = await Promise.all([latest(), installed()]);
    result = { status: Object.keys(available).every((key) => current[key] === available[key]) ? 'current' : 'needs-update',
      checkedAt: new Date().toISOString(), versions: current, latest: available };
  } catch (error) {
    result = { status: 'failed', error: error.message };
  }
  await saveSession(session, result, home);
  await fs.rmdir(lock);
  return result;
}

export async function updateSession(session, { home, update = updateDependencies, ...options } = {}) {
  if (!session) throw new Error('Missing cache key; use the daily entry point');
  const result = await checkSession(session, { home, ...options });
  if (result.status === 'current' || result.status === 'updated') return { ...result, skipped: true };
  if (result.status !== 'needs-update') throw new Error('The daily check failed or is in progress; it will not automatically retry');
  const lock = sessionRecord(session, home) + '.updating';
  try { await fs.mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('The daily update is in progress'); throw error; }
  try {
    await saveSession(session, { status: 'updating' }, home);
    const updated = await update();
    const versions = await (options.installed || installedVersions)();
    if (!Object.keys(result.latest).every((key) => versions[key] === result.latest[key])) throw new Error('Installed versions do not match the checked stable releases');
    const saved = { ...updated, versions, latest: result.latest, status: 'updated' };
    await saveSession(session, saved, home);
    return saved;
  } catch (error) {
    await saveSession(session, { status: 'failed', error: error.message }, home);
    throw error;
  } finally {
    await fs.rmdir(lock);
  }
}

// Local calendar date: one small shared record, independent of project/session.
export function dayId(now = new Date()) {
  return `day:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function checkDay({ now, ...options } = {}) { return checkSession(dayId(now), options); }
export function updateDay({ now, ...options } = {}) { return updateSession(dayId(now), options); }
