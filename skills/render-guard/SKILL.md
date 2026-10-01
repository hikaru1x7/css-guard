---
name: render-guard
license: CC0-1.0
description: Measure rendered CSS, desktop GUI and SVG changes before and after editing; preserve requested scope and require current visual evidence before completion.
---

- Read only the applicable mode reference: [CSS](references/css.md) for browser styles, [GUI](references/gui.md) for non-CSS application screens, or [SVG](references/svg.md) for SVG shape, text and stroke edits. If a task edits several modes, follow and verify each. General image editing and office documents are outside this skill.
- Only at the first applicable skill use each day, run `render-guard update`. Before-edit and Bash hooks share that first-of-day dependency check. Reuse it across tasks, projects and modes; current tools skip installation and tests. Do not automatically retry failures or call an unverified check successful.  Keep measurement tool versions fixed throughout each before/after comparison.
- Preserve the requested elements, purpose and behavior. Declare only necessary files with `render-guard <css|gui|svg> begin`. Existing CSS/GUI project settings and evidence remain usable. File scope does not authorize every change within those files. Preserve other edits.
- Measure the actual display before editing and open the PNGs. Record the requested and comparison elements, parent layout, state, viewport widths and relevant text settings. CSS uses Playwright for rendered rectangles, computed styles and rule sources; GUI verifies the running application and DPI; SVG also measures shape geometry, text, strokes and scaling. Specified code values are not rendered measurements.
- Batch related fixes, then remeasure the same target, comparisons, widths, state and toolchain. Update scope with `scope`; do not clear evidence by restarting `begin`, bypass hooks or relax comparison targets and checks to obtain a pass. Unlock protected targets only within the user's approved scope.
- Before completion, run `verify` for every edited mode and perform configured screenshot comparisons and project-specific text/state checks. Use evidence from the latest sources and running application. Inspect the images and numbers for unintended effects, then briefly report key before/after values and anything unverified. Do not remeasure after every small edit. Failed measurements or unverified runtime versions are not completion.
