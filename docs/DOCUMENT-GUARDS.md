# Native document measurements

Read this only when setting up, selecting or troubleshooting a document measurement method. Ordinary edits need the shared document reference and the applicable format reference.

| Intended application | Position measurement | Actual image |
|---|---|---|
| Microsoft Word desktop | Word Window.GetPoint; Range.Information for page and diagnostic values | Same Word Page.EnhMetaFileBits, or a screenshot of its actual window |
| Microsoft PowerPoint desktop | Shape frame and TextRange2 BoundLeft/Top/Width/Height separately | Same PowerPoint Slide.Export, or its actual window |
| PDF | Poppler text bounds plus Pillow painted-pixel bounds | Delivered PDF rendered by pdftoppm |

An ordinary screenshot is usable evidence when zoom, viewport and capture area are controlled. Locate the actual document region and measure pixels; merely taking a screenshot is not a measurement. Window movement, scrolling, hidden pages and another window obscuring content must not be treated as document layout changes. Playwright can operate browser Office, but that evidence certifies the browser application only. Do not convert desktop Office into browser previews to certify desktop layout.

HTML previews, LibreOffice rendering and converted PDFs cannot certify Microsoft desktop Office. Verify original Office output and PDF conversion separately. Record the intended version, fonts and zoom; do not imply compatibility with every other computer or version. Bounds do not certify clipping, missing content or visual quality: open and inspect actual images and required states.

## Office adapter

Requires Windows and the applicable installed Microsoft Office application. No additional OfficeCLI executable is needed. Supply at least two uniquely named targets, including unchanged comparisons.

Word targets:

```json
[{"name":"target","text":"TARGET"},{"name":"comparison","text":"REFERENCE"}]
```

PowerPoint targets:

```json
[{"name":"target","slide":1,"shape":"target"},{"name":"comparison","slide":1,"shape":"comparison"}]
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/measure-office.ps1 -InputDocument C:\project\file.docx -TargetsPath C:\project\targets.json -OutputDirectory C:\project\evidence -Label before -ShowMeasurementWindow
# Batch requested changes and flush pending edits to disk.
# Repeat the same command with -Label after.
```

For PPTX change InputDocument; ShowMeasurementWindow is unnecessary. WSL callers must supply Windows paths. Word requires the explicit measurement window: hidden Word page-image retrieval stalled in the tested environment.

The adapter opens read-only, disables macros/external content refresh, never saves the source, and records source/image SHA256, renderer/version, fresh measurement ID and actual bounds. External content requires a separately authorized procedure. Evidence must not go to Downloads. If the applicable Office application is already running, it stops rather than closing them: select another read-only route without terminating user work.

Word uses exact, unique body text. Missing, repeated or not fully visible targets fail. GetPoint gives a screen rectangle, not individual ink pixels. In the actual indent test, Range.Information did not detect horizontal movement; `rangeInformationPt` is diagnostic and cannot independently certify alignment. Control zoom/window position/scrolling for screen measurements. Headers, tables, shapes and targets spanning pages require suitable additional target handling.

PowerPoint addresses top-level shapes by exact name and records frame bounds and text bounds separately. Group children, table cells, intermediate animation states and complex rotated-text layout need further native measurements. Do not claim that the basic adapter covers them automatically.

## PDF adapter

Requires Python 3.10+, Pillow and Poppler's pdftoppm, pdftotext and pdfinfo. Prefer an existing environment; install only missing tools. Directly authored PDFs are included.

```json
[
  {"name":"target","page":1,"roiPt":[35,40,150,80],"background":[255,255,255]},
  {"name":"comparison","page":1,"roiPt":[35,100,150,140],"background":[255,255,255]}
]
```

roiPt is [left,top,right,bottom] in points from the rendered page's upper-left corner, after CropBox and rotation. Specify the background. Every non-background pixel within the region counts, including unrelated lines or patterns; do not mislabel the result as isolated glyph bounds. Empty/out-of-page regions and missing pages fail.

```bash
python3 <skill>/scripts/measure-pdf.py file.pdf --targets targets.json --output evidence --label before
# Batch fixes; repeat with --label after.
```

Records 144-DPI images, painted bounds, contained extracted words, page rotation/size and source/image hashes. Pixel measurement covers non-text graphics that text extraction cannot. When a specific PDF viewer is required, verify its actual display too; Poppler does not certify another viewer.

## Evidence verification

```bash
python3 <skill>/scripts/verify-documents.py --source file.pdf --before evidence/before.json --after evidence/after.json --comparison comparison
```

Works with Office records too. WSL maps Windows drive paths to /mnt. Checks current source hash, both sets of image hashes, fresh measurement identity, unchanged renderer/version/DPI, matching targets, and unchanged comparison positions/text/pages. Use `--allow-page-count-change` only for a user-requested change after checking affected pages. Explicitly justified drift uses `--max-drift`; do not mix screen pixels with document points when choosing tolerance.

This verifies evidence, not requested design correctness or visual review. Existing CSS/GUI/SVG automatic hooks remain; dedicated Office/PDF automatic edit hooks are not implemented. Do not claim all editing routes are mechanically blocked.

## Repository research and primary sources

Checked 2026-10-02:

- [OfficeCLI source snapshot](https://github.com/iOfficeAI/OfficeCLI/tree/7d8f777a34cef4e409ef6ca4cc22c532fc49ee07): inspected CommandBuilder.View.cs, Core/PowerPointPngBackend.cs and Core/WordPdfBackend.cs. Automatic rendering may fall back to HTML. Native PowerPoint PNG export informed the selected approach. The Word native path still converts Word to PDF and rasterizes PDF, so it is not the chosen replacement for direct Word page evidence.
- [docx2pdf source](https://github.com/AlJohri/docx2pdf/blob/main/docx2pdf/__init__.py): inspected Word-driven PDF conversion and application shutdown. Useful for conversion results; not independent proof of Word's editing display.
- [PyMuPDF text recipes](https://pymupdf.readthedocs.io/en/latest/recipes-text.html): a PDF bounds candidate. Existing Poppler/Pillow cover the tested requirement, so no new mandatory dependency was added.
- Microsoft: [Word GetPoint](https://learn.microsoft.com/en-us/office/vba/api/word.window.getpoint), [WdInformation](https://learn.microsoft.com/en-us/office/vba/api/word.wdinformation), [Word page image](https://learn.microsoft.com/en-us/office/vba/api/word.page.enhmetafilebits), [PowerPoint text bounds](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.textrange2.boundleft), [slide image export](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.slide.export).
- [Playwright supported browsers](https://playwright.dev/docs/browsers): browser measurement is not desktop Office measurement.

## Actual validation

Microsoft Word 16.0 and PowerPoint 16.0 on Windows: read-only before/after measurements of simple fixtures, with an 18-point target movement and an unchanged comparison. Word screen bounds moved 24 pixels; PowerPoint frame and text bounds both moved 18 points. Source hashes stayed unchanged during measurement. Native images were opened and inspected. Hidden Word imaging and Word's diagnostic position limitation were observed and incorporated into the procedure.

Direct PDF fixtures: measured 18-point movement, unchanged comparison, non-text shapes, CropBox and 90-degree rotation. Tests reject empty/outside/missing-page measurements, reused measurement IDs, re-edited sources, altered images and moved comparisons.

These fixtures do not validate every complex table, section, master, font, animation or Office version. Each actual project needs appropriate measurements and visual review.

An existing blank PowerPoint fixture application was preserved while the adapter refused measurement. Only the owned fixture application was closed after this test.
