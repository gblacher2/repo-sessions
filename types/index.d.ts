export type Peer = {
  id: string
  agent: 'claude' | 'codex'
  name: string
  cwd: string
  branch: string | null
  status: 'busy' | 'idle'
  since: number
  isSelf: boolean
  isWorktree: boolean
  /** Busy (1) or idle (0) per 15 s bucket, oldest first, last 10 minutes. */
  history: number[]
}

export type Subagent = { id: string; label: string; type: string }

export type Snapshot = {
  root: string
  peers: Peer[]
  subagents: Subagent[]
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'repo-sessions': { snapshot: Snapshot | null; isExpanded: boolean }
  }
}
