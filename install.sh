#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SKILLS="$HOME/.claude/skills"
AGENTS_SKILLS="$HOME/.agents/skills"
CODEX_DIR="$HOME/.codex"
LOCAL_BIN="$HOME/.local/bin"

CLI_ONLY=false
case "${1:-}" in
  --cli-only) CLI_ONLY=true ;;
  "") ;;
  --help|-h)
    printf '%s\n' 'Usage: ./install.sh [--cli-only]' 'Default: install CLI, skill links, and Claude Code/Codex hooks.' '--cli-only: install the CLI and browser without changing agent settings.'
    exit 0 ;;
  *) printf '%s\n' "Unknown option: $1" >&2; exit 1 ;;
esac
if [[ $# -gt 1 ]]; then
  printf '%s\n' 'Pass at most one option.' >&2
  exit 1
fi

ensure_link_target() {
  # 実ディレクトリを上書きせず、リンク先として安全か確認する。
  local target="$1"

  if [[ -d "$target" && ! -L "$target" ]]; then
    printf '%s\n' "Stopped: $target is a real directory. Review it and move it aside before rerunning the installer." >&2
    exit 1
  fi
}

cd "$ROOT"
npm ci

if ! node --input-type=module -e "import { chromium } from 'playwright'; import fs from 'node:fs'; process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)"; then
  npx playwright install chromium
fi

mkdir -p "$LOCAL_BIN"
ensure_link_target "$LOCAL_BIN/css-guard"

if [[ "$CLI_ONLY" == false ]]; then
  mkdir -p "$CLAUDE_SKILLS" "$AGENTS_SKILLS" "$CODEX_DIR"
  ensure_link_target "$CLAUDE_SKILLS/css-guard"
  ensure_link_target "$AGENTS_SKILLS/css-guard"
  ln -sfn "$ROOT/skills/css-guard" "$CLAUDE_SKILLS/css-guard"
  ln -sfn "$ROOT/skills/css-guard" "$AGENTS_SKILLS/css-guard"

  # Retain unrelated hooks and settings; back up changed files.
  node "$ROOT/scripts/merge-hooks.mjs" "$ROOT" "$ROOT/hooks/codex.hooks.template.json" "$CODEX_DIR/hooks.json"
  node "$ROOT/scripts/merge-hooks.mjs" "$ROOT" "$ROOT/hooks/claude.settings.template.json" "$HOME/.claude/settings.json"
  printf '%s\n' 'Claude Code: active in your next session.'
  printf '%s\n' 'Codex: review and trust the new hooks in /hooks before they can run.'
else
  printf '%s\n' 'CLI installed. Load skills/css-guard/SKILL.md in your agent; no agent settings were changed.'
fi

ln -sfn "$ROOT/bin/css-guard.mjs" "$LOCAL_BIN/css-guard"
node "$ROOT/bin/css-guard.mjs" doctor
