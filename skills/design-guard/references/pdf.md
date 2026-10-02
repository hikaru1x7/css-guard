# PDF

Include PDFs created directly. Render the delivered PDF itself; measure relevant page sizes, text/shapes, spacing and comparisons. Keep renderer, scale and page box fixed across revisions.

Poppler pdftotext -bbox-layout -cropbox supplies word/line/block coordinates; pdftoppm -cropbox -r 144 -png renders the same page box. Image-only PDFs, shapes, rotations and clipping require painted-pixel measurements rather than text coordinates alone. Text extraction success is not visual success. Adapter/limits: [document measurement](../../../docs/DOCUMENT-GUARDS.md).

PDF measurements share the maintained private Pillow runtime. Run `render-guard gui update --project <project>` on first applicable use each day; reuse the small shared daily record thereafter. Do not update OS Python or Office itself.
