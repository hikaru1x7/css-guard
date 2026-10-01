import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = ['playwright', 'pixelmatch', 'pngjs'];

export async function installedVersions(directory = root) {
  return Object.fromEntries(await Promise.all(packages.map(async (name) => {
    const value = JSON.parse(await fs.readFile(path.join(directory, 'node_modules', name, 'package.json'), 'utf8'));
    return [name, value.version];
  })));
}

export async function updateDependencies({ directory = root, run = runCommand } = {}) {
  const receipt = path.join(directory, '.guard-maintenance.json');
  let previous;
  try { previous = JSON.parse(await fs.readFile(receipt, 'utf8')); } catch {}
  await fs.rm(receipt, { force: true });
  run('npm', ['install', '--save-exact', '--engine-strict', '--no-audit', '--no-fund',
    ...packages.map((name) => `${name}@latest`)], directory);
  const versions = await installedVersions(directory);
  run(process.execPath, [path.join(directory, 'node_modules/playwright/cli.js'), 'install', 'chromium'], directory);
  if (JSON.stringify(previous?.versions) !== JSON.stringify(versions)) {
    run('npm', ['test'], directory);
  }
  run(process.execPath, ['--input-type=module', '-e',
    "import { chromium } from 'playwright'; const b = await chromium.launch(); await b.close();"], directory);
  const result = { checkedAt: new Date().toISOString(), versions };
  await fs.writeFile(receipt, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: ['ignore', 2, 2], timeout: 300000,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed to update or validate dependencies. Resolve the failure before measurement; explicitly retry with update --force.`);
}
