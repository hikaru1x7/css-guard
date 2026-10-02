# DesignGuard

**Measure the display. Keep edits within the request.**

One skill for requested visual work: CSS, native GUIs, SVG, Word, PowerPoint, PDF, diagrams, images and video. Ordinary revisions focus on guarding instructions and existing work; only from-scratch creation loads the extra design-building reference. Text-only or nonvisual work is excluded.

DesignGuard combines RenderGuard and Design Quality. It continues CSS Guard’s established measurement and scope protection. Existing CSS/GUI/SVG measurement and protection behavior, and shared hooks, remain in use. The public repository and skill are named `design-guard`; CLI, hook commands, configuration and state names keep `render-guard` for compatibility.

| Mode | Measurement | Tool |
|---|---|---|
| CSS | Rendered rectangles, computed styles, parent layout, rule sources and PNGs | Playwright |
| GUI | Correct running application, controls and comparisons, DPI, text and PNGs | Native Win32, UIAutomation, WinAppCLI or a project adapter |
| SVG | Shapes and comparisons, paint/text styles, transforms, local geometry and PNGs | Playwright |
| Word | Actual text positions and native page images | Microsoft Word desktop |
| PowerPoint | Separate shape/text bounds and native slide images | Microsoft PowerPoint desktop |
| PDF | Delivered PDF text and painted-pixel bounds | Poppler + Pillow |
| Other visual work | Actual output and comparisons in the intended environment | Appropriate existing tools |

Pillow, pixelmatch and pngjs compare images; they do not replace rendered control measurements. Office measurements use the actual intended Microsoft application; browser previews or converted PDFs do not certify desktop Office.

## Install once

Requires Git, Node.js 20.11+, Python 3.10+, npm, Bash, and an agent that can run local commands and inspect images. Windows control measurement requires Windows/WSL and a compatible adapter.

```bash
git clone https://github.com/hikaru1x7/design-guard.git
cd design-guard
./install.sh
```

The installer validates stable dependencies, installs matching Chromium and a private GUI image runtime, and installs applicable Windows measurement dependencies. It links the single skill into `~/.agents/skills/design-guard` and `~/.claude/skills/design-guard`, creates `~/.local/bin/render-guard`, and merges four shared hook handlers into both agents' settings. Unrelated settings/hooks remain intact; changed settings are backed up. Owned old RenderGuard registrations migrate to DesignGuard. Legacy CLI aliases remain for project compatibility and are not separate skills. Existing Design Quality directories are preserved; archive and unregister them separately when migrating that owned installation.

Codex: review and trust the new hooks in `/hooks`. Registration is not activation. Claude Code: start a new session after installation. Keep the checkout and `~/.local/bin` on PATH. Existing real skill directories are preserved.

For other agents, install the CLI without changing Claude/Codex settings:

```bash
./install.sh --cli-only
npx skills add hikaru1x7/design-guard --skill design-guard
```

Or read [the skill](skills/design-guard/SKILL.md) from your checkout. Installing instructions alone does not install tools or hooks. Other agents must review scope and evidence directly; verify cannot prove unrecorded edits.

## Ordinary use

Ask for visual creation or revisions normally. Invoke `$design-guard` in Codex or `/design-guard` in Claude when needed. The agent reads only the relevant mode instructions and handles measurement/check commands.

```bash
render-guard update # First applicable skill/hook use each day.
render-guard css begin --scope 'src/app.css' --snap
render-guard css measure / '#target' --label before
# Batch the requested fixes.
render-guard css measure / '#target' --label after
render-guard css snap
render-guard css verify
```

GUI uses `render-guard gui begin → build → after → verify`; source-based applications skip build but verify actually loaded sources. SVG uses `render-guard svg begin → measure before → measure after → verify`. For mixed tasks, check each edited mode. File scope is not permission to change every element in those files. Change scope without clearing evidence.

## Configure a project

New projects use `render-guard.json` with the needed `css`, `gui` and/or `svg` sections. See [the example](render-guard.example.json). Existing `css-guard.json` and `gui-guard.json`, state folders and measurements remain usable; conversion is optional. A unified section takes precedence over the matching legacy configuration.

- [CSS workflow and configuration](skills/design-guard/references/css.md)
- [GUI workflow](skills/design-guard/references/gui.md) and [adapter/settings details](engines/gui/GUARD.md)
- [SVG workflow and configuration](skills/design-guard/references/svg.md)

CSS saves its established evidence in `.css-guard/`; GUI keeps `.gui-guard/`. SVG uses `.render-guard/svg/` separately, preventing cross-mode overwrite. Automatic gates activate only in configured projects.

SVG requires a unique requested target and a separate unchanged comparison. It compares measured geometry/styles/markup and captured comparison pixels. Geometry boxes do not represent every stroke/filter/glyph pixel; inspect PNGs for clipping and painting outside bounds.

## Native documents

Word/PPTX use read-only Microsoft-native position and image adapters; directly authored PDFs use Poppler/Pillow. The same shared hooks used for CSS/GUI/SVG now check configured documents: measured before, declared scope, fresh after and a visual-review record before completion. Hooks never launch Office or render PDFs. See [configuration, methods, examples and limits](docs/DOCUMENT-GUARDS.md). Reinstall the hooks and review changed Codex definitions in `/hooks`; registration alone is not activation.

## Daily maintenance

The first skill or relevant before-edit/Bash hook use checks both toolchains' stable-version metadata. Tasks, projects, edits and mode changes in the same day reuse the records. Current versions skip installation, browser launches and full test runs. Hooks do not perform heavy updates. Run update before measurement when newer dependencies are required; keep versions fixed throughout before/after comparison.

The operating system’s local calendar date selects a small shared record. Session IDs are not needed for maintenance. Existing CSS/GUI maintenance caches are retained. Concurrent calls avoid duplicate checks; failures do not retry automatically. Installation or an explicit retry uses `update --force`. `install.sh --skip-update` only registers a previously validated environment.

Daily reuse reads a small file per toolchain, shared across sessions and projects. The operating system’s local date selects the record; the next day’s first applicable use checks again. A before/after comparison cannot pass if its measurement tool versions changed.

Private GUI dependencies leave system Python/Pillow and application libraries unchanged. Shared older Playwright browsers are preserved. WinAppCLI downloads require the official asset checksum and executable version, telemetry is disabled, and changed versions run actual Windows fixtures before success is recorded.

## Checks and practical limits

Hooks cover supported Claude Edit/Write/MultiEdit and Codex apply_patch edits, record changed targets, and require matching post-edit measurements. They preserve CSS scope/protected-file/whole-file checks and GUI source/binary/config/evidence checks. Writable Codex delegation needs the matching mode packet; read-only and explicitly non-visual work have supported exemptions. A packet never grants command execution permission.

Direct shell writes and unconfigured projects are not completely guarded. The CSS engine retains its error handling and one-time Stop block behavior; GUI checks retain their stricter version/evidence checks. A failing engine cannot hide another engine's rejection. Measurements do not prove good design or that the images were reviewed.

Validation includes existing CSS regressions, common-entry CSS parity, GUI protocol/check tests both directly and through the common entry, SVG browser measurements and refusal cases, and actual WinForms/WPF adapter fixtures at 96 DPI on WSL/Windows. Protocol tests use synthetic GUI screens; they are distinct from actual Windows measurements. High DPI, Qt/Tk, arbitrary custom drawing, macOS and other native OS workflows require project validation. The Japanese ordinary-mode references are about 33% shorter for CSS and 50% shorter for GUI than the previous two-skill combination, measured in characters. Token use, latency and actual design outcomes have not been benchmarked.

## Free to use

Released under [CC0 1.0 Universal](LICENSE). Use, modify, redistribute or sell this project's original work, including commercially, without attribution. Provided as-is, without warranties. Third-party dependencies retain their own licenses.

Community project; not affiliated with OpenAI, Anthropic or Microsoft.

See [validation evidence and the actual update exercise](docs/VALIDATION.md).
