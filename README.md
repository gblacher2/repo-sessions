# repo-sessions

A Claude Code mod that shows which Claude Code sessions and Codex threads are working in the current repository or folder, and whether each one is busy or idle.

![Sessions pane in light and dark mode](docs/preview.jpg)

## What it shows

- **Strip above the prompt** (default): the repository, how many other sessions are busy and idle, and a chip per session (busy first) with its agent color and how long it has been in that state. It shows in every session, collapsed, and lists nothing when no other session works in this repository.
- **Timeline** (the strip's button, or `/sessions-here`): expands the strip into a swimlane of every session on a shared 10-minute axis, busy periods drawn as bars in the agent's color.
- **Side pane** (`/sessions-pane`, optional): the same timeline with a header, docked beside the conversation.
- **Status line**: "N/M other sessions busy here".

A session counts as "here" when it works in this folder, a subfolder, a parent folder (not your home folder or `/`), or another git worktree of the same repository. The desktop Code tab draws SVG; the terminal draws a text version.

## How sessions are found

| Agent | Source | Busy when |
| --- | --- | --- |
| Claude Code | `~/.claude/sessions/<pid>.json` (skipped when the process has exited) | the session reports `busy` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` written in the last 60 minutes; title from `~/.codex/session_index.jsonl` | its log was written in the last 30 seconds |

A Codex thread waiting for your approval shows as idle. Activity history starts when the mod loads.

## Install

Add the folder to the `env` block of `~/.claude/settings.json`, then start a new session:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "~/GitHub & Coding Projects/repo-sessions"
}
```

For a single session: `claude --plugin-dir "~/GitHub & Coding Projects/repo-sessions"`.

## Development

```bash
claude plugin validate .
npx -p typescript tsc -p .
claude plugin test .
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code generates when it loads the mod (run `/plugin-types` otherwise). `claude plugin test` needs the hooks-module rollout switch on for your account.
