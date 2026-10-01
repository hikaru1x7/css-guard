# CSS Guard

**Less CSS guesswork. Fewer surprise changes.**

A lightweight CSS-editing skill for AI coding agents. Install it once, then ask for CSS changes as usual. The skill guides your agent to measure the actual page, keep edits within the request, and check the result.

**CSS-focused. Small instruction footprint. Built for everyday editing.**

Measure before editing. Batch the related fixes. Check once at the end. No repeated measurement after every edit, no extra stylelint run for every change, and no required companion design skill or MCP server.

## How you use it

After setup, ask your agent to fix spacing, sizing, alignment, or another CSS issue in ordinary language. In Claude Code and Codex, installed skills can be selected automatically when the request matches their description. If it is not selected, mention `css-guard`, use `/css-guard` in Claude Code, or `$css-guard` in Codex. See the official [Claude skill guide](https://code.claude.com/docs/en/skills) and [OpenAI skill guide](https://learn.chatgpt.com/docs/build-skills).

When the skill is used, the agent handles the measurement commands and checks as part of the CSS task. You do not need to run those commands yourself for each edit.

- **Measure before guessing.** Inspect rendered dimensions, computed styles, parent layout, CSS rule source candidates, and screenshots.
- **Keep the request in view.** Declare the files to edit, preserve existing changes, and inspect effects outside the requested elements.
- **Check the result.** Remeasure the same target, state, and viewport widths; compare configured pages and report what changed.

The skill can be used by other agents that support skills or can read the instructions, run local commands, and inspect images. Bundled hooks add automatic edit blocking for Claude Code and Codex. Other agents follow the skill's checks without those integrations.

## Install once

Requires Git, Node.js **20.11 or newer**, npm, Bash, and an agent that can run local commands and inspect images. Developed and tested on Linux/WSL, including browser measurements, live Claude Code edit/finish hooks, and live Claude Code/Codex delegation checks. macOS, native Windows, and other agents' end-to-end workflows have not been verified.

### Claude Code and Codex

```bash
git clone https://github.com/hikaru1x7/css-guard.git
cd css-guard
./install.sh
```

This installs the skill, its bundled measurement tool, Chromium if needed, and the automatic hooks. It links the skill into `~/.agents/skills/css-guard` and `~/.claude/skills/css-guard`, creates `~/.local/bin/css-guard`, and adds hooks to `~/.codex/hooks.json` and `~/.claude/settings.json`. Unrelated settings and hooks are retained; changed settings receive a `.bak.<timestamp>` backup. Rerunning from the same checkout does not duplicate its hooks.

Both integrations install four handlers: before editing, after editing, before finishing, and before delegating a writable task through `codex exec`.

- **Codex:** review and trust the new hooks in `/hooks` before they run. See the [official OpenAI hook documentation](https://learn.chatgpt.com/docs/hooks).
- **Claude Code:** start a new session after installation. See the [official hook documentation](https://code.claude.com/docs/en/hooks).

Keep the checkout in place and ensure `~/.local/bin` is on your `PATH`. If a skill directory already exists, review it and move it aside before installing; the installer refuses to overwrite real directories.

### Other agents

From the cloned checkout, install the measurement tool without changing Claude or Codex settings, then select your agent with the [Skills CLI](https://github.com/vercel-labs/skills#install-a-skill):

```bash
./install.sh --cli-only
npx skills add hikaru1x7/css-guard --skill css-guard
```

If your agent does not support skill installation, ask it to read [skills/css-guard/SKILL.md](skills/css-guard/SKILL.md) from your checkout instead. Installing only the instruction file does not install the bundled measurement tool or hooks.

### Project setup

Place a `css-guard.json` in the project you want to work on. Use [css-guard.example.json](css-guard.example.json), set your development server URL or static-site directory, and choose viewport widths, comparison routes, and protected targets. You can ask your agent to help with this setup.

Automatic edit checks activate only in projects containing this file. Projects without it are left alone.

## What is behind the skill

One short instruction file, a browser measurement tool, and optional hooks. The agent uses the tool to save dimensions, style information, and PNGs in the project's `.css-guard/` directory. Chromium may need downloading during initial installation. Task overhead depends on the pages and viewport widths checked; speed and token savings have not been benchmarked.

The bundled hooks reject supported edits outside declared files, edits without a recent measurement, whole-file replacement or deletion, and unapproved changes to protected targets. They request a matching post-edit measurement before the task ends.

These checks are limited to supported edit paths. Direct shell writes can bypass them; internal hook errors fail open, and the Stop check blocks once for the same edit. Other agents need to review scope, protected targets, and before/after evidence through the skill. `verify` cannot validate edits that no hook recorded. Measurements and screenshot differences support inspection; they do not prove a good design or replace review of the requested change.

Read the [agent operations reference](skills/css-guard/references/operations.md) for configuration, commands, source-mapping limitations, delegation, and uninstall details.

## Free to use

Released under [CC0 1.0 Universal](LICENSE), the same as [Codex Design Boost](https://github.com/hikaru1x7/codex-design-boost). Use, modify, redistribute, or sell this project's original work, including in commercial projects. No attribution required. Provided as-is, without warranties. See the [CC0 summary](https://creativecommons.org/publicdomain/zero/1.0/). Third-party dependencies retain their own licenses.

Community project; not affiliated with OpenAI or Anthropic.
