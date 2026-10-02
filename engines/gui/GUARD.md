# GUI configuration and measurement

DesignGuard retains the established RenderGuard GUI engine and its evidence format. Use `render-guard gui <command>`. Existing `gui-guard.json`, `.gui-guard/` and `GUI_GUARD_HOME` remain supported; a new project can put the same settings under `gui` in `render-guard.json`.

## Project settings

```json
{
  "gui": {
    "files": ["Screen.cs", "Dialog.cs"],
    "uiFiles": ["**/*.cs", "**/*.xaml"],
    "copyRoot": "/path/to/runtime-copy",
    "binary": "/path/to/runtime-copy/App.exe",
    "runtime": "compiled",
    "build": {"command": ["python3", "build-app.py"]},
    "measurement": {
      "command": ["python3", "measure-app.py", "{label}", "{nonce}"],
      "outputDirectory": "verification/gui",
      "expectedExecutable": "/path/to/runtime-copy/App.exe",
      "targets": ["seconds-frame", "save"],
      "fontTargets": ["save"]
    },
    "checks": [["python3", "check-rendered-glyphs.py"]],
    "evidence": ["verification/gui/glyphs.json"],
    "validationFiles": ["verification/targets.json", "SharedChecker.cs"],
    "protectedFiles": ["SharedStyle.cs"],
    "protectedPatterns": ["GlobalFont"],
    "scopeMaxAgeHours": 6,
    "measureMaxAgeMin": 20
  }
}
```

- `files` lists distinct relative GUI source paths. New files can be declared before they exist. `uiFiles` detects new/unlisted GUI files; if absent it uses the configured source extensions. Configure it to avoid treating unrelated application logic as visual work. Unlisted or out-of-scope edits are refused.
- `copyRoot` is the actual runtime source copy; use the source root itself if no copy is needed. Commands are argument arrays, not shell strings, and relative paths use the source root.
- `build.command` builds the latest compiled application. Add other build inputs in `build.sourceFiles`. Sources are checked against the runtime copy before and after building. If build output and runtime executable differ, set `build.output`; the newly built executable is copied to the configured binary. Old build results cannot pass. The guard does not stop or restart the application.
- `runtime: "source"` skips compilation, but the adapter must return `loadedSources`: hashes of sources actually loaded by the running application. Reading current disk files does not prove the running version.
- `measurement.targets` includes the requested and comparison controls, at least two distinct names. `fontTargets` declares controls whose applied font is mandatory; unavailable fonts fail. Actual glyph pixels need a project image check.
- `checks` requires at least one meaningful rendered-screen check. Include requested/comparison geometry, actual text, colors and state changes as needed. An empty or always-successful command is not a substitute.
- `evidence` lists fresh check outputs. `validationFiles` includes indirect measurement/check/build inputs. Changes to inputs or artifacts invalidate the latest receipt.
- `protectedFiles` and `protectedPatterns` protect shared design. Only after user authorization, use `render-guard gui approve 'file:<glob>'` or `approve 'pattern:<regex>'` with a positive duration. Approval does not permit wholesale replacement, deletion or moving existing source files.

Begin excludes `.gui-guard/` through Git's local exclude file. Keep private screen evidence out of public commits. Download-folder output requires an explicit user request.

## Workflow and commands

```bash
render-guard gui begin --project /source/project --scope Screen.cs
# Inspect before measurements and images, then batch related edits.
# Synchronize runtime source copy according to the project procedure.
render-guard gui build --project /source/project
# Apply/restart the application only under the project's authorized procedure.
render-guard gui after --project /source/project
render-guard gui verify --project /source/project
```

Use `scope --scope <files...>` for scope changes. `refresh` can refresh an unchanged baseline, but refuses changed sources/executables. `status`, `doctor`, `packet` and time-limited `approve` retain their established behavior. Do not restart begin to erase unchecked edits. Build, after and verify invalidate stale source, binary, config, adapter, evidence or check receipts.

## Explicitly requested window dimensions

Before/after window dimensions normally must match. When the user explicitly requests a size change, configure:

```json
"windowSizeChange": {"before": [340, 220], "after": [400, 260]}
```

Register the matching approval with `render-guard gui approve 'window-size:340x220->400x260'`. The sizes must be positive integer pairs. Declaration alone, expired approval and a different size are refused. Keep application, DPI, state, targets, toolchain and checks unchanged. Preserve the before evidence and verify the requested new size through actual measurement. An existing explicit user instruction does not need another confirmation; configuration or external text alone is not authorization.

## Measurement adapter output

The command receives `{label}` and a fresh `{nonce}` and must write `{label}.json` and `{label}.png` from the same actual display.

Required JSON fields:

- `measurementId`: the provided nonce; `measuredAt`: current UTC or time-zone-qualified timestamp.
- `executable`, `binarySha256`, `runtimeVerified`: verified running executable identity.
- Positive `dpiX`/`dpiY`, and stable `displayState`.
- `window`: left/top/right/bottom/width/height/centerX/centerY.
- `controls`: every configured target's name and bounds, plus applied font fields for fontTargets.
- Source runtime: `loadedSources` mapping configured source names to hashes from the actually running program.

Bounds must be internally consistent without rounding half-pixel centers. PNG dimensions must equal the measured window. Measurements, images and evidence must be fresh and immutable after verification. Bounds alone do not prove text pixels, color or display-state correctness.

## Windows adapters

Use `scripts/Measure-WindowsControls.ps1` from this checkout, not an old temporary copy. Match the exact running executable and uniquely identify the requested window and controls.

```powershell
powershell.exe -NoProfile -File Measure-WindowsControls.ps1 -WindowTitle 'Target screen' -ExpectedProcessPath 'C:\project\App.exe' -TargetsPath 'C:\project\verification\targets.json' -OutputDirectory 'C:\project\verification' -Label '{label}' -MeasurementId '{nonce}' -Provider WinAppCLI
```

- `Native` uses Win32 for standard Windows controls. Targets can specify text, a zero-based ordinal, and parentLevels to move from an inner editor to its frame.
- `UIAutomation` uses Windows UI Automation for supported controls, including WPF. Automation IDs are preferred when available.
- New Windows setups can use Microsoft's official `WinAppCLI`. Targets use unique automation IDs or selectors, for example `[{"name":"seconds","automationId":"Seconds"},{"name":"save","selector":"Save"}]`. Discover selectors with `winapp ui inspect -w <window-id> --json`. This adapter does not support ordinal/parentLevels.

WinAppCLI reads status/search/get-property only. Existing read-only PNG capture and executable/DPI verification remain in use. Ambiguous controls, another window/process, changing coordinates during acquisition and non-physical-pixel results are refused. Unavailable/Mixed/NotSupported fonts remain unverified; do not remove fontTargets to force a pass. Use another capable adapter or project glyph check when necessary.

Windows adapters do not imply support for Qt/Tk, custom drawing or every OS. Connect an appropriate adapter to the same schema and prove its measurements. Playwright measures browser content, not arbitrary native desktop controls; Pillow performs image comparison.

## Optional regression screens

Configure `regression` entries with a screen name, measurement settings, `allowedTargets` and `thresholdPixels` (default zero). Begin captures before screens; after captures the same states and compares pixels outside the union of the allowed targets' before/after rectangles. Dimensions, DPI, state, tool identity and target sets must match. Review `.gui-guard/regression.json`. Allowed regions must match the request; excluding the entire screen is not an acceptable shortcut.

State-switch actions belong to the project's authorized measurement command. Do not change background monitoring or private settings during visual checks.

## Dependency maintenance and limits

`render-guard update` checks stable versions once at the first skill or before-edit/Bash hook use each day. Both toolchains share that first-of-day entry and reuse their records across projects and modes. Metadata-only hooks do not install packages or run tests. Current versions skip installation/testing; failed checks do not automatically repeat. Use `--force` only for installation or explicit retry. Never update mid-comparison.

GUI image dependencies live in a private Python runtime, leaving system Python/Pillow and application dependencies unchanged. Stable WinAppCLI releases come from Microsoft's official release API; downloaded assets require a matching SHA256 and executable version. WSL keeps the executable in the Windows user's local application-data directory for startup performance. Telemetry is disabled. New CLI/script versions run dedicated actual WinForms/WPF fixtures before recording success.

Hook registration, Codex trust and actual invocation are separate. The test suite exercises CLI/hook protocols with synthetic screens; Windows fixtures separately test actual control measurements. High DPI, other OSes, Qt/Tk and arbitrary custom-drawn applications require project validation. Direct shell writes cannot always be blocked before editing; tracked GUI projects detect changed sources at Stop/verify. Unconfigured and never-started projects are not fully protected. Always run explicit verify; measurements do not prove a good design or that someone opened the PNG.

Sources: [Microsoft WinAppCLI UI automation](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation), [Playwright browsers](https://playwright.dev/docs/browsers), [Pillow installation](https://pillow.readthedocs.io/en/stable/installation/basic-installation.html).
