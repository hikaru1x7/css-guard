# GUI

Use configured projects. Read [details](../../../engines/gui/GUARD.md) only for setup, adapter selection, explicitly requested dimension changes, delegation or hook trust. New apps need a minimal runnable screen and usable measurement before substantial visual work.

```bash
render-guard gui begin --project '<source-root>' --scope '<file>'
# Batch fixes; synchronize source to the runtime copy.
render-guard gui build --project '<source-root>' # compiled runtimes only
# Apply the latest build to the authorized runtime location.
render-guard gui after --project '<source-root>'
render-guard gui verify --project '<source-root>'
```

- Reproduce the reported operation/state and locate its cause first. Small fixes measure the requested control, comparison and relevant states once before/after; capture bounds, text, colors and images together. Include other screens when shared components/fonts change.
- Existing profiles are selected automatically only by a unique exact match with begin's file scope. No manual suite selection. Missing/ambiguous mappings retain all checks; do not add or shrink mappings to pass the current fix. Changes outside the focused sources, including shared build sources, cannot pass that suite.
- after always captures the current screen. Only configured leading checks that read captured measurements may reuse completed results when version, inputs, evidence, fresh image and control data match within the validity period. Other-screen, interaction and save checks rerun even after success; unconfigured suites and regression comparisons do not reuse results. Validation code changes mid-comparison are refused. Use phase timings to locate delays.
- Match the running app, source and runtime copy. Preserve dimensions, DPI and state. Source runtimes must identify actually loaded sources.
- Measure input frames, inner editors, arrows, text, buttons and comparisons separately. Center Y is `(top+bottom)/2`; gap is `next left-previous right`. Preserve half pixels; check changed fonts, sizes, rendering and actual glyph edges. Frame success is not text success. Selection fixes require actual selected text visibility, editing and manual copy checks.
- Inspect `.gui-guard/comparison.json`, before/after images, changed states and unintended effects. Unavailable controls/fonts remain unverified. Justify tolerances using user requirements and scale; project-specific values stay in the project.
- Preserve background monitoring/private settings. Restart/save only through approved project procedures. Measurement is read-only; do not mix notification, sound or external-send tests into it. Downloads and `-AllowDownloads` require explicit user instruction.
