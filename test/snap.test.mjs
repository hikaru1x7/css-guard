import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cli, json, repo, tempProject } from './helpers.mjs';

test('snap は基準から変化ピクセル数を出し、無変更なら 0', async () => {
  const project = await tempProject(); const site = path.join(project.root, 'site'); await fs.cp(path.join(repo, 'test/fixtures/site'), site, { recursive: true });
  await fs.writeFile(path.join(project.root, 'css-guard.json'), JSON.stringify({ static: 'site', routes: ['/index.html'], widths: [375] }));
  const baseline = json(await cli(project, ['snap'])); assert.equal(baseline.entries[0].createdBaseline, true);
  await fs.appendFile(path.join(site, 'site.css'), '\nbody { background: black; }\n');
  const changed = json(await cli(project, ['snap'])); assert.ok(changed.entries[0].changedPixels > 0); await fs.access(changed.entries[0].diff);
  json(await cli(project, ['snap', '--baseline']));
  const same = json(await cli(project, ['snap'])); assert.equal(same.entries[0].changedPixels, 0);
});
