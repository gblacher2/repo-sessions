# repo-sessions agent instructions

## Project overview

Claude Code mod (hooks plugin) that lists the Claude Code sessions and Codex
threads working in the current repository, for the desktop Code tab and the
terminal. See README.md.

## Architecture

- `hooks/register.tsx`: hooks module. Scans every 3 s (`$.clock.every`), writes
  one snapshot to `$.state`, draws the `Pane` and `AbovePrompt` components.
- `hooks/draw.ts`: pure SVG and text drawing helpers with no `$`, so they can be
  rendered outside Claude Code.
- `types/index.d.ts`: the `$.state` contract.
- `tests/render.test.ts`: `claude plugin test` suite with a faked host.

Functions that take `$` must be top-level function declarations in the same file
(the validator follows `$` only into those), and state is written with
`$.state.set`, never through an imported helper.

## Development

Load for one session: `claude --plugin-dir .`. Load everywhere: add this folder
to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.

## Validation

```bash
claude plugin validate .
npx -p typescript tsc -p .
claude plugin test .
```

Manual: open `/sessions-here` in a repository with other sessions on both the
desktop Code tab and a terminal.

## Coding conventions

TypeScript, strict. No dependencies. UI text is labels only.

## GitHub workflow and agent guardrails

- GitHub is the canonical system of record. Record durable decisions, acceptance
  criteria, implementation state, review findings, and validation in the repository,
  Issues, or pull requests rather than only in an AI conversation.
- Meaningful work uses an Issue or equivalent complete PR context, a scoped branch,
  an early draft PR, review comments, verification, and a final `READY FOR HUMAN` state.
- Use `feat/`, `fix/`, `refactor/`, or `chore/` branch prefixes. Do not implement normal
  feature work directly on `main` and do not merge without human authorization.
- Inspect the existing architecture and `git status` before changing files. Preserve
  unrelated local work and prefer minimal, scoped modifications.
- Do not suppress type or lint failures, replace working implementations unnecessarily,
  introduce dependencies without justification, or alter unrelated code.
- Never commit secrets, credentials, `.env` values, personal data, local databases,
  logs, or machine-specific state. Commit reconstruction-safe examples and setup docs.
- Push meaningful checkpoints and keep the PR accurate so a fresh agent can continue
  from GitHub alone.
