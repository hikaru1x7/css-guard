# CSS

Use Playwright for rectangles, parent layout, computed styles and cascade rules. Serve and edit the same tree. Choose widths/actions according to project requirements and change reach; keep them fixed.

```bash
render-guard css begin --scope '<file>' # add --snap for configured full-page comparisons
render-guard css measure '<URL>' '<selector>' --label before
# Batch cause-related fixes.
render-guard css measure '<URL>' '<selector>' --label after
# Configured full-page comparison: render-guard css snap
render-guard css verify
```

Scope updates include all files. Read [details](css-operations.md) only for installation, missing configuration, special actions or delegation. Installing instructions does not install tools/hooks. Verify cannot certify edits no hook recorded.
