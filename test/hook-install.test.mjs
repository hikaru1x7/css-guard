import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');

for (const directory of ['css-guard', 'CSS Guard team\'s "folder" $example']) {
  test(`installed hooks execute from ${directory} and preserve existing settings on rerun`, async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'css-guard-hook-install-'));
    try {
      const root = path.join(temporary, directory);
      const script = path.join(root, 'bin/css-guard.mjs');
      await fs.mkdir(path.dirname(script), { recursive: true });
      await fs.writeFile(script, 'process.stdout.write(JSON.stringify({ script: process.argv[1], command: process.argv[2] }));\n');

      for (const template of ['codex.hooks.template.json', 'claude.settings.template.json']) {
        const target = path.join(temporary, template);
        const unrelated = { type: 'command', command: 'echo unrelated' };
        await fs.writeFile(target, JSON.stringify({ setting: 'keep', hooks: { PreToolUse: [{ matcher: 'OtherTool', hooks: [unrelated] }] } }));
        const original = JSON.parse(await fs.readFile(path.join(repo, 'hooks', template), 'utf8'));
        const expected = Object.values(original.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks)).length;
        assert.equal(expected, 4);
        assert.ok(original.hooks.PreToolUse.some((group) => group.matcher === 'Bash' && group.hooks.some((hook) => hook.command.endsWith(' hook-bash'))));

        for (let attempt = 0; attempt < 2; attempt++) {
          const merged = spawnSync(process.execPath, [path.join(repo, 'scripts/merge-hooks.mjs'), root, path.join(repo, 'hooks', template), target], { encoding: 'utf8' });
          assert.equal(merged.status, 0, merged.stderr);
          const settings = JSON.parse(await fs.readFile(target, 'utf8'));
          assert.equal(settings.setting, 'keep');
          const hooks = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
          assert.equal(hooks.length, expected + 1);
          assert.deepEqual(hooks.find((hook) => hook.command === unrelated.command), unrelated);

          for (const hook of hooks.filter((hook) => hook.command !== unrelated.command)) {
            const executed = spawnSync(hook.command, { shell: true, encoding: 'utf8' });
            assert.equal(executed.status, 0, executed.stderr);
            const result = JSON.parse(executed.stdout);
            assert.equal(result.script, script);
            assert.match(result.command, /^hook-(pre|post|stop|bash)$/);
            if (directory === 'css-guard') {
              assert.equal(hook.command, `node ${script} ${result.command}`);
            }
          }
        }
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
}
