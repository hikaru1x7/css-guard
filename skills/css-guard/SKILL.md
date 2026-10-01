---
name: css-guard
description: Measure rendered dimensions and applied CSS rules before and after CSS edits, and guard against changes outside the requested scope.
license: CC0-1.0
---

- Preserve the requested element and purpose. Inspect definitions and usage, then declare only the necessary files with `css-guard begin --scope "<file>"`. This does not authorize every change in those files. Preserve existing edits and check for effects outside the request.
- Before editing, run `css-guard measure "<URL>" "<selector>" --label before`. Inspect rendered dimensions, parent layout, styles, and the applied rules in cascade; open the PNGs too. Do not substitute specified CSS values for rendered measurements. Measure the page served from the same working tree you edit.
- Batch the changes needed to address the cause, then run `measure --label after` with the same URL, element, state, and viewport widths. Check numbers, PNGs, and diffs for the result and out-of-scope effects; briefly report key before/after values and anything unverified. Do not remeasure after every edit or repeat checks unnecessarily. If measurement fails, do not claim completion.
- Choose viewport widths according to the change's reach and the project's requirements, and keep them consistent before and after. When full-page comparison is configured, start with `begin --snap` and run `css-guard snap` once at the end.
- To update scope, pass all target files to `css-guard scope`. Do not rerun `begin`, which clears measurements, or bypass hooks. Unlock protected targets only within user-approved scope. Read the [README](https://github.com/hikaru1x7/css-guard#install) when installation, environment, state actions, or delegation details are needed. The skill requires the CSS Guard CLI and hooks; installing this instruction file alone does not install them.
