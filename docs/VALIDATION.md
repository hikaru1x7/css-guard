# RenderGuard validation

Checked on 2026-10-02 on Ubuntu/WSL with Windows, Node.js 22 and Python 3.12.

## Preserved behavior

- The existing CSS regressions pass. The common entry produces the same requested rectangles, parent measurements, styles and cascade entries as the legacy entry; transient local server ports are normalized in comparison tests.
- CSS before-edit, post-edit and completion gates remain active through the common entry for Claude and Codex.
- GUI regression tests run directly and through the common entry. Source/build/runtime identity, comparison controls, DPI, hashes, protected changes and incomplete evidence keep their established rejection behavior.
- Common hook and installation tests preserve unrelated settings, safely quote paths, replace owned legacy handlers, retain all engine rejections and remain stable on repeated installation.
- SVG browser tests cover geometry, text length, stroke-only lines, comparison pixels, changed comparison targets, ambiguous targets and mismatched conditions. SVG evidence does not overwrite CSS evidence. Rendered PNGs were inspected.

## Actual update exercise

A disposable checkout and separate maintenance records were used. The ordinary installation was not downgraded.

| Component | Starting version | Checked and installed stable version |
|---|---|---|
| Playwright | 1.62.1 | 1.63.0 |
| pixelmatch | 5.3.0 | 7.2.0 |
| pngjs | 7.0.0 | 7.0.0 |
| Pillow | 12.2.0 | 12.3.0 |
| WinAppCLI | v0.7.0 | v0.7.1 |

The daily check detected outdated tools, actual installers ran, the installed versions were read back, browser startup and regression checks passed, and update success was recorded only after verification. The same-day repeat returned `skipped: true` for both toolchains with no installer/test output. The ordinary installation was also updated and its repeat skipped.

WinAppCLI v0.7.1 passed actual WinForms Native and WPF UIAutomation/WinAppCLI measurements at 96 DPI. Controls whose font information is unavailable remain explicitly unverified. Downloads require the official asset checksum; simultaneous extraction accepts another checkout's result only when executable hashes match.

Unit tests verify shared daily results across projects and sessions, one metadata check despite repeated calls, a new check on the next local calendar day, concurrency, cached failures, and rejection when an updater exits successfully but the installed version remains old. Private Pillow metadata is read directly even if a child updater created its environment after the parent process started.

To repeat the actual update exercise, create a disposable checkout, set isolated `CSS_GUARD_HOME` and `GUI_GUARD_HOME` directories, install older packages only there, and run `render-guard update` twice. Compare the first result with the official npm/PyPI/GitHub stable metadata and require the second result to skip. Do not downgrade a working shared installation or update during a before/after comparison.

The final public checkout passed 46 Node/browser checks, 46 GUI checks through the common entry, and four GUI daily-maintenance checks. Skill metadata and relative documentation links were also validated.

## Commands and limits

```bash
npm test
npm run test:gui
npm run test:gui-routing
python3 engines/gui/scripts/test_session_maintenance.py
```

Synthetic GUI protocol fixtures and actual Windows adapter tests are different checks. High DPI, Qt/Tk, custom drawing, other native operating systems and live agent hook activation require separate validation. Registering new Codex hooks does not prove they are trusted; review `/hooks`. Maintenance reuse reads small local records and performs no repeated network check, but total hook latency and token savings have not been benchmarked.
