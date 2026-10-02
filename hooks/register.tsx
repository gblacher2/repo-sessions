import type { EngineInterface, Register } from 'claude-code'

import type { Peer, Snapshot, Subagent } from '../types'

import { BUCKET_MS, HISTORY_BUCKETS, ago, paneSvg, relativeCwd, stripText, summarySvg } from './draw'

const PANE = 'repo-sessions'
const TITLE = 'Sessions here'
const POLL_MS = 3000
// A Codex thread counts as busy while its log was written this recently,
// and is listed at all while written within the window.
const CODEX_BUSY_MS = 30_000
const CODEX_WINDOW_MIN = 60

const SNAPSHOT = { plugin: 'repo-sessions', key: 'snapshot' } as const
const EXPANDED = { plugin: 'repo-sessions', key: 'isExpanded' } as const

type SessionFile = {
  pid: number
  sessionId: string
  cwd: string
  name?: string
  status?: string
  statusUpdatedAt?: number
  updatedAt?: number
  startedAt?: number
}

type Found = Omit<Peer, 'branch' | 'isWorktree' | 'history'>

const isInside = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)

// Git's shared .git dir per folder: two worktrees of one repo share it.
const commonDirCache = new Map<string, string | null>()
// Codex rollout file -> its cwd, read once from the file's first line.
const codexCwdCache = new Map<string, string | null>()
let home: string | null = null
let selfId = ''
let polling = false
// Busy/idle per 15 s bucket for each session, kept across scans.
const histories = new Map<string, { bucket: number; values: number[] }>()

function recordHistory(key: string, isBusy: boolean, now: number) {
  const bucket = Math.floor(now / BUCKET_MS)
  const h = histories.get(key) ?? { bucket, values: new Array<number>(HISTORY_BUCKETS).fill(0) }
  const shift = Math.min(HISTORY_BUCKETS, bucket - h.bucket)
  if (shift > 0) h.values = [...h.values.slice(shift), ...new Array<number>(shift).fill(0)]
  h.bucket = bucket
  if (isBusy) h.values[HISTORY_BUCKETS - 1] = 1
  histories.set(key, h)
  return [...h.values]
}

async function run($: EngineInterface, argv: string[]) {
  try {
    const r = await $.process.run(argv, { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function commonDir($: EngineInterface, cwd: string) {
  if (!commonDirCache.has(cwd)) {
    const out = await run($, ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    commonDirCache.set(cwd, out === null ? null : out.trim())
  }
  return commonDirCache.get(cwd) ?? null
}

async function claudeSessions($: EngineInterface, now: number): Promise<Found[]> {
  const dir = `${home}/.claude/sessions`
  const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  const files: SessionFile[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      files.push(JSON.parse(await $.fs.read(`${dir}/${entry.name}`)))
    } catch {
      // mid-write; the next tick reads it
    }
  }
  if (files.length === 0) return []

  const ps = await run($, ['ps', '-o', 'pid=', '-p', files.map(f => f.pid).join(',')])
  const alive = new Set((ps ?? '').split('\n').map(l => Number(l.trim())).filter(Boolean))

  return files
    .filter(f => alive.has(f.pid) && typeof f.cwd === 'string')
    .map(f => ({
      id: f.sessionId,
      agent: 'claude' as const,
      name: f.name || f.sessionId.slice(0, 8),
      cwd: f.cwd,
      status: f.status === 'busy' ? ('busy' as const) : ('idle' as const),
      since: f.statusUpdatedAt ?? f.updatedAt ?? f.startedAt ?? now,
      isSelf: f.sessionId === selfId,
    }))
}

async function codexThreads($: EngineInterface, now: number): Promise<Found[]> {
  const out = await run($, [
    'find', `${home}/.codex/sessions`, '-name', 'rollout-*.jsonl',
    '-mmin', `-${CODEX_WINDOW_MIN}`, '-exec', 'stat', '-f', '%m %N', '{}', '+',
  ])
  if (!out) return []

  const recent = out.split('\n').filter(Boolean).map(line => {
    const space = line.indexOf(' ')
    return { mtime: Number(line.slice(0, space)) * 1000, path: line.slice(space + 1) }
  })
  if (recent.length === 0) return []

  const index = await run($, ['tail', '-n', '1000', `${home}/.codex/session_index.jsonl`])
  const names = new Map<string, string>()
  for (const line of (index ?? '').split('\n')) {
    try {
      const row = JSON.parse(line)
      if (row.id && row.thread_name) names.set(row.id, row.thread_name)
    } catch {
      // partial line
    }
  }

  const found: Found[] = []
  for (const { mtime, path } of recent) {
    if (!codexCwdCache.has(path)) {
      const head = await run($, ['head', '-c', '4000', path])
      const match = head?.match(/"cwd":("(?:[^"\\]|\\.)*")/)
      codexCwdCache.set(path, match?.[1] ? JSON.parse(match[1]) : null)
    }
    const cwd = codexCwdCache.get(path)
    if (!cwd) continue
    const id = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? path
    found.push({
      id,
      agent: 'codex',
      name: names.get(id) ?? id.slice(0, 8),
      cwd,
      status: now - mtime < CODEX_BUSY_MS ? 'busy' : 'idle',
      since: mtime,
      isSelf: false,
    })
  }
  return found
}

async function scan($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    if (home === null) home = ((await run($, ['printenv', 'HOME'])) ?? '').trim()
    const now = await $.clock.now()
    const root = await $.session.root()
    const myCommon = await commonDir($, root)

    const all = [...(await claudeSessions($, now)), ...(await codexThreads($, now))]
    const peers: Peer[] = []
    for (const f of all) {
      // A session in a parent folder counts too, but not one opened at home or /.
      const isBroad = f.cwd === home || f.cwd === '/'
      const sameFolder = isInside(f.cwd, root) || (!isBroad && isInside(root, f.cwd))
      const sameRepo = !sameFolder && myCommon !== null && (await commonDir($, f.cwd)) === myCommon
      if (!sameFolder && !sameRepo) continue
      const branch = myCommon === null ? null : await run($, ['git', '-C', f.cwd, 'branch', '--show-current'])
      const history = recordHistory(`${f.agent}:${f.id}`, f.status === 'busy', now)
      peers.push({ ...f, branch: branch?.trim() || null, isWorktree: sameRepo, history })
    }
    peers.sort((a, b) =>
      a.isSelf !== b.isSelf ? (a.isSelf ? -1 : 1)
      : a.status !== b.status ? (a.status === 'busy' ? -1 : 1)
      : b.since - a.since,
    )

    const subagents: Subagent[] = (await $.agent.list())
      .filter(a => a.status === 'running')
      .map(a => ({ id: a.id, label: a.name ?? a.description, type: a.type }))

    const others = peers.filter(p => !p.isSelf)
    const busy = others.filter(p => p.status === 'busy').length
    $.ui.status(others.length === 0 ? undefined : `${busy}/${others.length} other sessions busy here`)

    const snap: Snapshot = { root, peers, subagents, checkedAt: now }
    await $.state.set(SNAPSHOT, snap)
  } finally {
    polling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    selfId = await $.session.id()
    await $.command.register({
      name: 'sessions-here',
      description: 'Expand or collapse the sessions strip above the prompt',
    })
    await $.command.register({
      name: 'sessions-pane',
      description: 'Open the sessions timeline in a side pane',
    })
    await scan($)
    $.clock.every(POLL_MS, () => scan($))

    return started
  })

  on('command.run', { command: 'sessions-here' }, async $ => {
    const { value: isExpanded = false } = await $.state.get(EXPANDED)
    await $.state.set(EXPANDED, !isExpanded)
    await scan($)

    return { text: isExpanded ? 'Sessions strip collapsed.' : 'Sessions strip expanded.' }
  })

  on('command.run', { command: 'sessions-pane' }, async $ => {
    await scan($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Sessions pane opened.' }
  })

  // Default view: a strip above the prompt, collapsed to one row of chips,
  // expanding in place to the full timeline.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: snap } = await $.state.get(SNAPSHOT)
    const { value: isExpanded = false } = await $.state.get(EXPANDED)
    const others = (snap?.peers ?? []).filter(p => !p.isSelf)
    if (!snap || e.props.hasSurvey) return next(e)

    const toggle = () => $.state.set(EXPANDED, !isExpanded)
    const label = isExpanded ? 'Collapse' : 'Timeline'

    if (e.surface !== 'terminal') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      // Room for the chips: the band's width less the toggle button.
      const room = Math.min(1000, Math.max(320, e.props.bodyColumns * 7.5 - 100))
      const summary = summarySvg(snap, room)
      const timeline = isExpanded ? paneSvg(snap, 560, { withHeader: false, isFixed: true }) : null

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Svg source={summary.source} width={summary.width} height={summary.height} alt={`${others.length} other sessions in this repo`} />
            <Button key="toggle" label={label} dimColor onPress={toggle} />
          </Box>
          {timeline && (
            <Svg source={timeline.source} width={timeline.width} height={timeline.height} alt="Session activity, last 10 minutes" />
          )}
        </Box>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = others.filter(p => p.status === 'busy').length

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text wrap="truncate-end">
            <Text bold>{snap.root.split('/').pop()}</Text>
            <Text dimColor> {busy} busy · {others.length - busy} idle  </Text>
            {others.map(p => (
              <Text key={`${p.agent}-${p.id}`}>
                <Text color={p.status === 'busy' ? '#0ca30c' : 'gray'}>{p.status === 'busy' ? '●' : '○'}</Text>
                <Text color={p.agent === 'codex' ? '#3987e5' : '#d95926'}>■</Text>
                <Text dimColor={p.status !== 'busy'}> {p.name}  </Text>
              </Text>
            ))}
          </Text>
          <Button key="toggle" label={label} dimColor onPress={toggle} />
        </Box>
        {isExpanded &&
          others.map(p => (
            <Text key={`row-${p.agent}-${p.id}`} wrap="truncate-end">
              <Text color={p.agent === 'codex' ? '#3987e5' : '#d95926'}>{stripText(p.history)}</Text>
              <Text dimColor> {p.status} {ago(snap.checkedAt - p.since)} · </Text>
              {p.name}
            </Text>
          ))}
      </Box>
    )
  })

  // Optional side pane (/sessions-pane): the same timeline with a header.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { value: snap } = await $.state.get(SNAPSHOT)

    if (e.surface !== 'terminal') {
      const { Svg, Text } = $.ui.resolve(e)
      if (!snap) return <Text>Scanning…</Text>
      const pane = paneSvg(snap)

      return <Svg source={pane.source} alt={`${snap.peers.length} sessions in this repo`} />
    }

    const { Box, Text } = $.ui.resolve(e)
    if (!snap) return <Text dimColor>Scanning…</Text>

    return (
      <Box flexDirection="column">
        {snap.peers.map(p => (
          <Box key={`${p.agent}-${p.id}`} flexDirection="column" marginTop={1}>
            <Text wrap="truncate-end">
              <Text color={p.status === 'busy' ? '#0ca30c' : 'gray'}>{p.status === 'busy' ? '●' : '○'} </Text>
              <Text bold={p.status === 'busy'}>{p.name}</Text>
            </Text>
            <Text wrap="truncate-end">
              {'  '}<Text color={p.agent === 'codex' ? '#3987e5' : '#d95926'}>{stripText(p.history)}</Text>
              <Text dimColor>
                {' '}{p.isSelf ? 'You · ' : ''}{p.status} {ago(snap.checkedAt - p.since)}
                {p.branch ? ` · ${p.branch}` : ''}
                {relativeCwd(p.cwd, snap.root) ? ` · ${relativeCwd(p.cwd, snap.root)}` : ''}
              </Text>
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
