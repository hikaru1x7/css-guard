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


## DesignGuard integration and document measurement (2026-10-02)

The skill entry now combines the two former skills while reading only the applicable mode. Japanese ordinary instructions fell from 3,137 to 2,117 characters for CSS, and from 4,889 to 2,445 for GUI. This is instruction-size comparison, not a latency, token-use or design-quality benchmark. Creation instructions are excluded from revision routing.

The established CSS/GUI/SVG measurement and protection behavior and hook entry commands are preserved. Installer tests cover migration to the single skill while preserving unrelated settings. Office/PDF now use a branch of the same hooks; updated post-hook matchers need trust review before automatic use.

## Shared document hook checks (2026-10-02)

The maintainer confirmed completion of the local Codex trust review for the final shared-hook definitions. Those definitions remained unchanged afterward. This resolves the local pending trust step; it does not establish automatic execution on every agent surface or remove the trust review required for other installations. This follow-up changes documentation only; implementation was already published in commit `076149f`.

Ten added integration tests exercise real PDF rendering, before/after source hashes, declared scope, retained baselines, comparison movement, stale measurements after generator edits, image changes, explicit creation mode, unknown-generator changes at Stop, configuration drift/removal, file-edit tools and canonical Bash routing. All 57 Node tests pass in both checkouts; the three real PDF adapter tests also pass. A visual-review record is an attestation, not machine proof of image opening or correct design.

The shared post-Bash branch checks only document files/records and does not relaunch the CSS/SVG/GUI engines or a renderer. Do not infer universal interception of arbitrary unconfigured outputs or every cloud execution surface from these tests.

Microsoft Word 16.0 and PowerPoint 16.0 were remeasured through the new hook workflow: before-edit denial, begin, allowed edit, Stop rejection, fresh native after, actual image opening, then verify and Stop success. Word moved 24px and PPT frame/text moved 18pt; comparisons were unchanged and measurement did not alter sources. A directly authored PDF passed the same workflow after images were opened. These are helper/CLI integration checks, not proof of automatic hooks on every agent surface.

Twenty document-branch pre-Bash calls averaged about 0.47ms without configuration and 1.94ms with a one-page PDF in this environment. These figures exclude process startup, existing engines and large-file hashing.

Microsoft Word 16.0 and PowerPoint 16.0 on Windows were actually measured read-only before/after an 18-point move. Word screen bounds moved 24 pixels; PowerPoint frame and text bounds both moved 18 points, with unchanged comparisons and native images inspected. Word diagnostic Range.Information missed indent movement, so it is not used alone. PDF tests cover actual text and non-text pixels, cropped/rotated pages and stale/modified evidence refusals. See [methods and limitations](DOCUMENT-GUARDS.md). These are simple fixtures, not validation of arbitrary complex Office documents.

```bash
npm test
npm run test:documents
RENDER_GUARD_FORWARD_TEST=1 python3 engines/gui/scripts/test_gui_guard.py
```
