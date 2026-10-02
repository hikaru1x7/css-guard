# Word

For Microsoft Word delivery, measure Word's own repaginated display. Check paragraphs, tables, images, headings, page count and live numbers/references, including downstream pagination effects.

Windows Word exposes Range.Information page numbers/page-relative positions and Window.GetPoint screen rectangles for visible Range/Shape objects. Negative/failed results are unmeasured. Scroll targets into view with fixed zoom. Multiline range rectangles are not glyph-pixel outlines.

Use the same Word instance's Page.EnhMetaFileBits page image or actual screen capture. Check table splits, clipping and image placement too. PDF conversion is not required. The read-only adapter and tested procedure are in [document measurement](../../../docs/DOCUMENT-GUARDS.md).

Range.Information positions may miss indent movement. Prioritize GetPoint and actual images; treat these page-position values as diagnostic.
