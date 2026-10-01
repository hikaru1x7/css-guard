#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SKILLS="$HOME/.claude/skills"
AGENTS_SKILLS="$HOME/.agents/skills"
CODEX_DIR="$HOME/.codex"
LOCAL_BIN="$HOME/.local/bin"

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

mkdir -p "$CLAUDE_SKILLS" "$AGENTS_SKILLS" "$CODEX_DIR" "$LOCAL_BIN"
ensure_link_target "$CLAUDE_SKILLS/css-guard"
ensure_link_target "$AGENTS_SKILLS/css-guard"
ensure_link_target "$LOCAL_BIN/css-guard"
ln -sfn "$ROOT/skills/css-guard" "$CLAUDE_SKILLS/css-guard"
ln -sfn "$ROOT/skills/css-guard" "$AGENTS_SKILLS/css-guard"
ln -sfn "$ROOT/bin/css-guard.mjs" "$LOCAL_BIN/css-guard"

# フックの登録。既存のフックは残し、css-guard の分だけ入れ替える（控えは同名 .bak.<日時>）。
node "$ROOT/scripts/merge-hooks.mjs" "$ROOT" "$ROOT/hooks/codex.hooks.template.json" "$CODEX_DIR/hooks.json"
node "$ROOT/scripts/merge-hooks.mjs" "$ROOT" "$ROOT/hooks/claude.settings.template.json" "$HOME/.claude/settings.json"

printf '%s\n' 'Claude Code: active in your next session.'
printf '%s\n' 'Codex: review and trust the new hooks in /hooks before they can run.'
node "$ROOT/bin/css-guard.mjs" doctor
