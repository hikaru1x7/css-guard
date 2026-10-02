# SVG

Use for shape/text/stroke code. CSS outside an image uses CSS mode.

```bash
render-guard svg begin --scope '<file.svg>' # add --snap for configured full-page comparisons
render-guard svg measure '<URL>' '<selector>' --label before
# Batch related fixes.
render-guard svg measure '<URL>' '<selector>' --label after
# Configured full-page comparison: render-guard svg snap
render-guard svg verify
```

- Select a unique target and separate unchanged comparisons, never its parent/descendant. Group multiple requested shapes and place comparisons outside. Check geometry, styles, markup and captured pixels.
- Inspect Playwright rectangles, paint/stroke, transforms, viewBox, attributes and text lengths. geometryBox is local geometry, not full stroke/filter/glyph pixels. Open PNGs to inspect clipping and stroke overflow.
- Missing setup: use the svg section in [the example](../../../render-guard.example.json). Evidence in `.render-guard/svg/` must not overwrite CSS. List dynamic generators in svgFiles; unconfigured projects, direct shell writes and all dynamic paths are not fully protected. Inspect full-page diffs including expected changes.
