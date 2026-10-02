#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ONLY=false
SKIP_UPDATE=false
INSTALL_HOME="$HOME"
SKILL_DIR="$ROOT/skill"
if [[ -d "$ROOT/skills/design-guard" ]]; then SKILL_DIR="$ROOT/skills/design-guard"; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cli-only) CLI_ONLY=true ;;
    --skip-update) SKIP_UPDATE=true ;;
    --home) INSTALL_HOME="$2"; shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
  shift
done
ensure_link_target() {
  if [[ -e "$1" && ! -L "$1" ]]; then
    printf 'Existing file or directory preserved: %s\n' "$1" >&2
    exit 1
  fi
}
cd "$ROOT"
if [[ "$SKIP_UPDATE" == false ]]; then
  node "$ROOT/bin/render-guard.mjs" update --force
fi
mkdir -p "$INSTALL_HOME/.local/bin"
for name in render-guard css-guard gui-guard; do ensure_link_target "$INSTALL_HOME/.local/bin/$name"; done
ln -sfn "$ROOT/bin/render-guard.mjs" "$INSTALL_HOME/.local/bin/render-guard"
ln -sfn "$ROOT/bin/css-guard.mjs" "$INSTALL_HOME/.local/bin/css-guard"
ln -sfn "$ROOT/engines/gui/scripts/gui-guard.py" "$INSTALL_HOME/.local/bin/gui-guard"
chmod +x "$ROOT/bin/render-guard.mjs" "$ROOT/engines/gui/scripts/gui-guard.py"
if [[ "$CLI_ONLY" == true ]]; then exit 0; fi
mkdir -p "$INSTALL_HOME/.agents/skills" "$INSTALL_HOME/.claude/skills" "$INSTALL_HOME/.codex"
for directory in "$INSTALL_HOME/.agents/skills" "$INSTALL_HOME/.claude/skills"; do
  ensure_link_target "$directory/design-guard"
  if [[ -L "$directory/design-guard" && "$(readlink "$directory/design-guard")" != "$SKILL_DIR" ]]; then
    printf 'Unrelated skill link preserved: %s\n' "$directory/design-guard" >&2
    exit 1
  fi
  ln -sfn "$SKILL_DIR" "$directory/design-guard"
  if [[ -L "$directory/render-guard" ]]; then
    legacy_target="$(readlink "$directory/render-guard")"
    if [[ "$legacy_target" == "$ROOT/skill" || "$legacy_target" == "$ROOT/skills/render-guard" || "$legacy_target" == "$SKILL_DIR" ]]; then rm "$directory/render-guard"; fi
  fi
  if [[ -L "$directory/css-guard" ]]; then
    legacy_target="$(readlink "$directory/css-guard")"
    if [[ "$legacy_target" == "$ROOT/skill" || "$legacy_target" == "$ROOT/skills/css-guard" ]]; then rm "$directory/css-guard"; fi
  fi
  if [[ -L "$directory/gui-guard" ]]; then
    legacy_target="$(readlink "$directory/gui-guard")"
    if [[ "$legacy_target" == "$INSTALL_HOME/.codex/skills/gui-guard" || "$legacy_target" == "$ROOT/engines/gui" ]]; then rm "$directory/gui-guard"; fi
  fi
done
node "$ROOT/scripts/merge-hooks.mjs" "$ROOT" "$ROOT/hooks/codex.hooks.template.json" "$INSTALL_HOME/.codex/hooks.json" "$INSTALL_HOME/.codex/skills/gui-guard/scripts/gui-guard.py"
node "$ROOT/scripts/merge-hooks.mjs" "$ROOT" "$ROOT/hooks/claude.settings.template.json" "$INSTALL_HOME/.claude/settings.json" "$INSTALL_HOME/.codex/skills/gui-guard/scripts/gui-guard.py"
printf '%s\n' 'DesignGuard installed. Codex: review and trust the new hooks in /hooks. Claude Code: start a new session.'
