# RenderGuard architecture

One skill and one CLI/hook entry route to distinct measurement engines. Mode-specific acceptance rules remain intact; GUI controls are not reduced to screenshot-only checks and CSS does not inherit unrelated GUI build requirements.

- CSS retains bin/css-guard.mjs, rendered style/cascade/rectangle measurement, existing scope/protection rules, legacy configuration and evidence storage.
- GUI retains the version-2 native/source runtime protocol, copy/build identity, DPI/state, comparison controls, font requirements, validation inputs and immutable evidence receipts. It lives under engines/gui without a standalone SKILL.md.
- SVG reuses the browser toolchain, adds shape/text/paint/transform data and comparison-pixel checks, and writes its own .render-guard/svg state. CSS evidence cannot satisfy SVG edits.

render-guard.json has independent css/gui/svg sections. A matching unified section takes precedence over a legacy config. Existing CSS/GUI projects need no conversion. Every edited mode must pass its own verify.

The hook entry sends each supported input to all engines, which filter configured projects and applicable files. Results are combined without discarding any refusal. GUI malformed-input refusal remains enforced; CSS retains its established internal error handling. Post/Stop refusals preserve the appropriate hook response format. Added MultiEdit and apply_patch forms normalize into the existing edit model.

The first applicable before-edit/Bash hook or skill update checks both toolchains once per local calendar day. Existing engine caches and locks are reused. Mode/project/task changes cause no repeated network checks. Hooks never install packages or run full tests. Measurement versions remain fixed during comparisons.

SVG measures geometry separately from painted pixels. Comparison geometry, computed styles, markup and captured image pixels must remain unchanged. Before/after URL, selectors, viewport widths, actions and tool versions must match. A failed after measurement does not clear pending edits. Standalone SVG screenshots use Playwright's Chromium CDP capture without changing the document; HTML/CSS retain the original screenshot path. Stroke-only lines are supported even when geometric height or width is zero. Crops include stroke-aware padding but do not claim complete arbitrary filter/glyph pixel bounds.

Installation replaces this checkout's legacy CSS/GUI hook commands with four combined handlers, preserving unrelated settings and backing up changes. Codex registration and trust are separate. Compatibility CLI names and existing project adapter paths may remain without a standalone skill. Old packet markers remain accepted for existing delegation workflows.

Verification covers existing CSS behavior, common-entry parity, GUI tests directly and through routing, SVG browser checks/refusals and installation preservation. GUI protocol fixtures are synthetic; actual Windows control tests separately cover Native, UIAutomation and WinAppCLI at 96 DPI. Other environments require project validation.


## DesignGuard skill routing

The single design-guard skill combines RenderGuard and Design Quality. Ordinary revisions read the short shared guard plus the applicable measurement references. Only from-scratch creation reads create.md; setup and repository research are conditional. User instructions and approved work remain authoritative.

Existing CSS/GUI/SVG measurement and protection behavior and CLI/configuration names remain in use. Office/PDF add a document branch to the same shared hooks, requiring measured scope and fresh native evidence plus a visual-review record at completion. The post-hook also tracks Bash; changed definitions require Codex trust review. Desktop Office requires its intended Microsoft renderer, not HTML or converted-PDF certification. See [document methods and research](DOCUMENT-GUARDS.md).
