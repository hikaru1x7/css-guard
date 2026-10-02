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
      const script = path.join(root, 'bin/render-guard.mjs');
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
        assert.equal(original.hooks.PostToolUse.filter((group) => group.matcher.split('|').includes('Bash')).length, 1);

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

test('combined installation migrates owned legacy hooks and skills without changing unrelated settings', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'render-guard-install-'));
  try {
    for (const relative of ['.codex/hooks.json', '.claude/settings.json']) {
      const target = path.join(home, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, JSON.stringify({ keep: 'unchanged', hooks: { PreToolUse: [
        { matcher: 'OtherTool', hooks: [{ type: 'command', command: 'echo unrelated' }] },
        { matcher: 'apply_patch', hooks: [{ type: 'command', command: `node ${repo}/bin/css-guard.mjs hook-pre` }] },
        { matcher: 'apply_patch', hooks: [{ type: 'command', command: `python3 ${home}/.codex/skills/gui-guard/scripts/gui-guard.py hook-pre` }] }
      ] } }));
    }
    await fs.mkdir(path.join(home, '.agents/skills'), { recursive: true });
    await fs.symlink(path.join(repo, 'skill'), path.join(home, '.agents/skills/css-guard'));
    await fs.symlink(path.join(repo, 'skill'), path.join(home, '.agents/skills/render-guard'));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync('bash', [path.join(repo, 'install.sh'), '--skip-update', '--home', home], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      for (const relative of ['.codex/hooks.json', '.claude/settings.json']) {
        const settings = JSON.parse(await fs.readFile(path.join(home, relative), 'utf8'));
        assert.equal(settings.keep, 'unchanged');
        const handlers = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
        assert.equal(handlers.length, 5);
        assert.equal(handlers.filter((hook) => hook.command.includes('bin/render-guard.mjs')).length, 4);
        assert.equal(handlers.filter((hook) => hook.command === 'echo unrelated').length, 1);
      }
    }
    await fs.access(path.join(home, '.agents/skills/design-guard/SKILL.md'));
    assert.equal(await fs.lstat(path.join(home, '.agents/skills/css-guard')).catch(() => null), null);
    assert.equal(await fs.lstat(path.join(home, '.agents/skills/render-guard')).catch(() => null), null);
    await fs.access(path.join(home, '.claude/skills/design-guard/SKILL.md'));
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});


test('installation preserves unrelated skill links', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'design-guard-preserve-'));
  try {
    const skills = path.join(home, '.agents/skills');
    await fs.mkdir(skills, { recursive: true });
    const unrelated = path.join(home, 'custom-skill');
    await fs.mkdir(unrelated);
    await fs.symlink(unrelated, path.join(skills, 'render-guard'));
    const installed = spawnSync('bash', [path.join(repo, 'install.sh'), '--skip-update', '--home', home], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(await fs.readlink(path.join(skills, 'render-guard')), unrelated);
    await fs.unlink(path.join(skills, 'design-guard'));
    await fs.symlink(unrelated, path.join(skills, 'design-guard'));
    const refused = spawnSync('bash', [path.join(repo, 'install.sh'), '--skip-update', '--home', home], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.equal(await fs.readlink(path.join(skills, 'design-guard')), unrelated);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
