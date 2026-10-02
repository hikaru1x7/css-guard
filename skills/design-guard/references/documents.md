# Word / PowerPoint / PDF

- Record targets/comparisons, protected content/structure, intended app/version, fonts, zoom and delivery format. Keep conditions fixed and retain source SHA256, current images and measurements. Reuse existing tools; read setup details only when needed.
- Measure actual positions, dimensions, padding and text bounds. XML values and HTML previews do not certify Office rendering. Converted PDFs are conversion evidence, not proof of the original document. Unavailable intended apps remain unverified; never silently switch renderers.
- Measurement is read-only with macros/external updates disabled. Do not save/change the source or close unrelated documents/apps. Flush pending officecli edits with save/close before an external reader.
- Remeasure affected pages/slides and comparisons after batched fixes; expand checks for global styles or pagination changes. Open images for missing/clipped/overlapping content. Layout boxes are not actual glyph-pixel bounds. Dedicated automatic edit hooks are not added for these formats; do not claim all paths are mechanically enforced.

When using the bundled adapters, finish with `scripts/verify-documents.py --source <document> --before <before.json> --after <after.json> --comparison <comparison-name>` and inspect the images. Read [setup details](../../../docs/DOCUMENT-GUARDS.md) only when needed.
