# SVG code editing

Use this mode for SVG shapes, text and strokes. CSS changes to the outside of an image belong to CSS mode. General photo or illustration evaluation is outside this mode.

Configure the project's `render-guard.json` with an `svg` section. Existing CSS/GUI configurations need no conversion. SVG evidence is kept separately in `.render-guard/svg/`, so SVG work cannot overwrite a CSS before measurement.

```json
{
  "svg": {
    "static": ".",
    "widths": [1280, 375],
    "comparisonSelectors": ["#unchanged-label"],
    "protectedFiles": ["shared-icons.svg"]
  }
}
```

```bash
render-guard svg begin --scope diagram.svg
render-guard svg measure /diagram.svg '#requested-shape' --label before
# Batch related fixes.
render-guard svg measure /diagram.svg '#requested-shape' --label after
render-guard svg verify
```

Select exactly one target and at least one separate unchanged comparison element. A comparison must not be the target's parent or descendant. For several requested shapes, select their shared group and comparisons outside that group. Changes to comparison geometry, styles, markup or captured pixels fail the after measurement and leave edits unverified. Do not reduce the comparison set to force a pass.

Playwright measures screen rectangles, computed paint/text styles, local shape geometry, screen transformation matrices, viewBox, attributes and rendered text length. It captures screenshots of the target and comparisons. `geometryBox` describes geometry in local SVG units, not the complete painted bounds of strokes, filters or glyphs. Text length and frame measurements do not prove glyph-pixel bounds or absence of clipping; open the before/after PNGs.

Keep URL, target, comparisons, actions, viewport widths and tool versions fixed. Hidden or ambiguous targets and changed comparison conditions are rejected. Scope, protected-file and whole-file rules reuse the CSS engine. If full-page routes are configured, capture them with begin --snap and compare with snap at the end. Full-page diffs include expected edits and require inspection.

Hooks recognize configured `.svg` files and supported inline SVG element/attribute edits in HTML/JSX and similar files. List other SVG-generating sources in `svgFiles`. Direct shell writes, unconfigured projects and every possible dynamic generator are not fully covered. Do not omit explicit before/after measurement and diff review.
