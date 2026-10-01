# CSS Guard

**Less CSS guesswork. Fewer surprise changes.**

You ask your AI agent to fix some spacing. It guesses at the CSS, changes a shared rule, and another part of the page shifts.

CSS Guard gives Claude Code and Codex CLI lightweight guardrails specifically for CSS editing: measure the actual page, declare the files to change, batch related fixes, then check the same page again.

A small tool, automatic checks, and one short skill. Built to fit into everyday CSS editing.

## CSS-focused. Light on ceremony.

Measure before editing. Batch the related fixes. Check once at the end.

No repeated measurement after every edit, no extra stylelint run for every change, and no required companion design skill or MCP server. The checks focus on the files, rendered measurements, and protected targets needed for the current CSS task.

The instruction file is short; the complete setup also includes Playwright and Chromium. Initial installation may take longer if Chromium needs downloading. Actual task overhead depends on the pages and viewport widths you check; speed and token savings have not been benchmarked.

## What it does

- **Measure before guessing.** Capture element dimensions, computed styles, parent layout, CSS rule source candidates and line numbers, and screenshots.
- **Keep edits in scope.** Reject supported edits outside declared files, edits without a recent measurement, and changes to configured protected selectors or files without approval.
- **Check the result.** Request a new measurement of the same target, state, and viewport widths after CSS changes. Compare configured full-page screenshots too.
- **Give the agent something to inspect.** Save PNGs for Codex's `view_image` or Claude's `Read`; no MCP server required.

The automatic checks cover supported editing tools, not every way to write a file. They do not decide whether a design looks good or whether every changed property matches the user's intent. See [limitations](#limitations).

## Install

Requires Git, Node.js **20.11 or newer**, npm, Bash, and a hook-capable version of Claude Code or Codex CLI. Developed and tested on Linux/WSL; macOS and native Windows have not been verified.

```bash
git clone https://github.com/hikaru1x7/css-guard.git
cd css-guard
./install.sh
```

The installer downloads dependencies and Chromium if needed, creates `~/.local/bin/css-guard`, links the skill into `~/.agents/skills/css-guard` and `~/.claude/skills/css-guard`, and adds hooks to `~/.codex/hooks.json` and `~/.claude/settings.json`. Existing unrelated hooks and settings are retained. Changed settings files receive a `.bak.<timestamp>` backup. Rerunning the installer does not duplicate hooks from this checkout.

Keep the checkout in place: the links and hooks point to it. Ensure `~/.local/bin` is on your `PATH`. If a skill directory already exists, review it and move it aside before installing; the installer refuses to overwrite real directories.

- **Codex:** review and trust the new hooks in `/hooks` before they run. See the [official OpenAI hook documentation](https://learn.chatgpt.com/docs/hooks).
- **Claude Code:** start a new session after installation. See the [official hook documentation](https://code.claude.com/docs/en/hooks).

Installing only `SKILL.md` through a skills installer does **not** install the CLI, browser, or hooks. Use the full installation above.

## Use

Place a `css-guard.json` in the project you want to protect. Copy [css-guard.example.json](css-guard.example.json), set your development server URL, and adjust the files, widths, and routes.

Automatic edit checks activate only in projects containing this configuration file. Projects without it are left alone.

Ask your agent:

```text
Use $css-guard to fix this element's spacing. Keep the changes within the
request, measure before and after, and inspect the screenshots.
```

For Claude Code, invoke `/css-guard`. The workflow is:

```bash
css-guard begin --scope "src/styles/app.css" --snap
css-guard measure / "#target" --label before
# Make related fixes together.
css-guard measure / "#target" --label after
css-guard snap
css-guard verify
```

Use `--snap` when full-page comparison is configured. Update scope with `css-guard scope` instead of restarting `begin`, which clears measurement records. Measurements and screenshots are saved in the project's `.css-guard/` directory; `begin` attempts to exclude it through Git's local exclude file.

## Configuration

| Key | Purpose |
| --- | --- |
| `baseUrl` | Development server URL; mutually exclusive with `static` |
| `static` | Static site directory, served by a temporary local server |
| `widths` | Viewport widths; default `[1280, 375]` |
| `routes` | Pages to compare with `snap` |
| `protectedSelectors` | Shared selectors to protect, such as `:root` or `.btn`; default empty |
| `protectedFiles` | File globs to protect; default empty |

Other settings: `requireScope` and `requireMeasure` (default `true`), `measureMaxAgeMin` (20), `scopeMaxAgeHours` (6), `snapThresholdPx` (0), `styleFiles`, `markupFiles`, `gateClassNames` (default `false`, opt in for Tailwind/class changes), and `heights` (viewport height by width).

`!important` and line-removal counts alone do not block edits. Existing `maxRemovedLines` settings are ignored. Run your project's normal code checks separately.

## Commands

| Command | Purpose |
| --- | --- |
| `begin --scope <glob...> [--snap] [--static <dir>]` | Reset the task state and declare files; optionally capture baseline screenshots |
| `scope <glob...>` | Replace the declared scope without clearing measurements |
| `measure <url\|path> <selector> [--widths 1280,375] [--parents 2] [--actions "click:#a;wait:300"] [--label name] [--json]` | Measure the rendered target and parents; save screenshots and compare the previous measurement |
| `snap [--baseline] [--routes ...] [--widths ...] [--json]` | Compare configured full-page screenshots; create a baseline if absent |
| `approve <selector\|file:glob> [--minutes 120]` | Temporarily unlock a protected target after user approval |
| `verify [--json]` | Check recorded post-edit measurement and snapshot status; exit 1 if incomplete |
| `packet [--scope <glob...>] [--url <path>] [--selector <sel>]` | Generate CSS instructions for a delegated Codex task |
| `status` / `doctor` | Inspect task state or installation |

Actions support `click:`, `fill:selector=text`, `hover:`, `wait:ms`, and `goto:`. Keep the URL, selector, actions, and viewport widths consistent before and after.

## Delegating from Claude to Codex

For CSS work, prepend `css-guard packet` output to the Codex task instructions. Use the same working tree that serves the measured page and a writable sandbox so the tool can save `.css-guard/`. Run `css-guard verify` after the delegated task returns.

The Claude Bash hook checks direct writable `codex exec` commands for the packet and matching working tree. Read-only calls pass through. Non-visual work can include `<!-- css-guard: none -->`; this does not disable Codex's CSS checks.

## Limitations

- Edit blocking covers Claude's `Edit`/`Write` and Codex's `apply_patch`. Direct shell writes can bypass it. These hooks are workflow checks, not a security boundary.
- Hooks fail open on internal errors, logging the error rather than stopping all work. The Stop check blocks once for the same edit, rather than creating an endless loop. Check `verify` before reporting completion.
- The scope is file-based. The skill and diff review still need to preserve the requested elements and properties.
- CSS rule sources are diagnostic candidates. Inline or framework-generated CSS may report page lines instead of original source-file lines; complex cascade cases need inspection.
- Screenshot differences flag changed pixels, including expected edits. The agent still needs to inspect them; a successful measurement is not proof of a good design.
- Delegation checks cannot see commands hidden inside wrapper scripts or destinations without `css-guard.json`.

## Disable or remove

To disable checks for one project, remove or rename its `css-guard.json`. To uninstall, remove only hook handlers pointing to this checkout's `bin/css-guard.mjs` from both settings files, then remove the CLI and skill links that point to this checkout. Preserve unrelated settings and other installations. Restart your agents; remove the checkout only after removing its hooks and links.

## Free to use

Released under [CC0 1.0 Universal](LICENSE), the same as [Codex Design Boost](https://github.com/hikaru1x7/codex-design-boost). Use, modify, redistribute, or sell this project's original work, including in commercial projects. No attribution required. Provided as-is, without warranties. See the [CC0 summary](https://creativecommons.org/publicdomain/zero/1.0/). Third-party dependencies retain their own licenses.

Community project; not affiliated with OpenAI or Anthropic.
