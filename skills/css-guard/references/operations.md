# Agent operations

These are the commands the agent runs behind the skill. Users can request CSS changes in ordinary language.

## Editing workflow

```bash
css-guard begin --scope "src/styles/app.css" --snap
css-guard measure / "#target" --label before
# Batch related fixes.
css-guard measure / "#target" --label after
css-guard snap
```

Use `--snap` when full-page comparison is configured. With the bundled hook integrations, finish with `css-guard verify` too. Update scope with `css-guard scope` instead of restarting `begin`, which clears measurement records. Measurements and screenshots are saved in the project's `.css-guard/` directory; `begin` attempts to exclude it through Git's local exclude file.

With other agents, review scope, protected targets, diffs, and before/after evidence directly. `verify` only checks edits recorded by hooks and cannot validate unrecorded edits from other agents.

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

