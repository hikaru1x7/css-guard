# Agent operations

These are the commands the agent runs behind the skill. Users can request CSS changes in ordinary language.

## Editing workflow

```bash
render-guard update  # First applicable skill/hook use each day; not every task.
render-guard css begin --scope "src/styles/app.css" --snap
render-guard css measure / "#target" --label before
# Batch related fixes.
render-guard css measure / "#target" --label after
render-guard css snap
```

Use `--snap` when full-page comparison is configured. With the bundled hook integrations, finish with `render-guard css verify` too. Update scope with `render-guard css scope` instead of restarting `begin`, which clears measurement records. Measurements and screenshots are saved in the project's `.css-guard/` directory; `begin` attempts to exclude it through Git's local exclude file.

With other agents, review scope, protected targets, diffs, and before/after evidence directly. `verify` only checks edits recorded by hooks and cannot validate unrecorded edits from other agents.

## Dependency maintenance

Use `render-guard update` at the first applicable skill use each day. Before-edit and Bash hooks share that daily record, so a hook that runs first can perform the lightweight stable-version check. Reuse the record across tasks and projects; no repeated network checks, installs, browser launches, or full test runs. When installed versions are already current, maintenance ends after checking metadata.

When an update is required, the command installs stable Playwright, pixelmatch, and pngjs releases, installs matching Chromium, and validates them. Hooks report the update requirement; they do not run installation or the full test suite within the hook timeout. Dependencies are recorded in package.json and the lockfile after updating. Shared older browsers are preserved. Keep the tool versions fixed for each before/after comparison.

The local calendar date selects a shared record in `~/.cache/css-guard/maintenance` (or `CSS_GUARD_HOME/maintenance`). Other projects and sessions read the same small file; no server or scan of session results is involved. Simultaneous invocations do not repeat a check. A failed or interrupted check is not success and is not retried automatically; resolve the cause and explicitly use `update --force` to retry. Installation also uses `--force` and requires network access, npm, and a supported Node.js version.

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
| `update [--json]` | Check stable dependencies once per local calendar day; update and validate only when needed |
| `update --force [--json]` | Explicit installation or retry; bypass the daily cache |
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

For CSS work, prepend `render-guard css packet` output to the Codex task instructions. Use the same working tree that serves the measured page and a writable sandbox so the tool can save `.css-guard/`. Run `render-guard css verify` after the delegated task returns.

The Claude and Codex Bash hooks check direct writable `codex exec` commands for the packet and matching working tree. Read-only calls pass through. Non-visual work can include `<!-- css-guard: none -->`; this does not disable Codex's CSS checks.

The agent's command-permission checks still apply. A valid packet does not grant permission to execute a command. If a separate permission check denies it, report the denial and obtain the required approval; do not bypass it or treat the delegated task as completed.

## Limitations

- Edit blocking covers Claude's `Edit`/`Write`/`MultiEdit` and Codex's `apply_patch`. Direct shell writes can bypass it. These hooks are workflow checks, not a security boundary.
- Hooks fail open on internal errors, logging the error rather than stopping all work. The Stop check blocks once for the same edit, rather than creating an endless loop. Check `verify` before reporting completion.
- The scope is file-based. The skill and diff review still need to preserve the requested elements and properties.
- CSS rule sources are diagnostic candidates. Inline or framework-generated CSS may report page lines instead of original source-file lines; complex cascade cases need inspection.
- Screenshot differences flag changed pixels, including expected edits. The agent still needs to inspect them; a successful measurement is not proof of a good design.
- Delegation checks cannot see commands hidden inside wrapper scripts or destinations without a CSS configuration.

## Disable or remove

Remove a project's CSS section or legacy `css-guard.json` to disable its CSS checks. For the combined installation, remove only handlers pointing to this checkout's `bin/render-guard.mjs`, then remove the `design-guard` skill and CLI links belonging to this checkout. Preserve unrelated settings and other installations. Restart agents before deleting the checkout. Legacy CSS/GUI CLI aliases are compatibility tools, not separate skills.
