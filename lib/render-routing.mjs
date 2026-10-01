export function combineHooks(kind, results) {
  const messages = results.filter(Boolean).map((result) => result.hookSpecificOutput?.permissionDecisionReason || result.reason || result.message).filter(Boolean);
  if (!messages.length) return null;
  const reason = [...new Set(messages)].join('\n').replace(/\bcss-guard (?=[a-z])/g, 'render-guard css ').replace(/\bgui-guard (?=[a-z])/g, 'render-guard gui ');
  return ['hook-stop', 'hook-post'].includes(kind)
    ? { decision: 'block', reason }
    : { hookSpecificOutput: { hookEventName: kind === 'hook-post' ? 'PostToolUse' : 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

export function present(text, mode) {
  // Keep packet markers and existing state/config names for compatibility.
  const output = text.split('\n').map((line) => line.includes('<!--') ? line : line
    .replace(/\b(?:css-guard|gui-guard) update\b/g, 'render-guard update')
    .replace(/\bcss-guard (?=[a-z])/g, `render-guard ${mode} `)
    .replace(/\bgui-guard (?=[a-z])/g, 'render-guard gui ')
    .replace(/~\/\.(agents|claude)\/skills\/css-guard\/SKILL\.md/g, '~/.agents/skills/render-guard/SKILL.md')
    .replace(/~\/\.claude\/skills\/gui-guard\/SKILL\.md/g, '~/.claude/skills/render-guard/SKILL.md')
  ).join('\n');
  return mode === 'svg' ? output.replace(/\bCSS\b/g, 'SVG').replaceAll('.css-guard/', '.render-guard/svg/') : output;
}
