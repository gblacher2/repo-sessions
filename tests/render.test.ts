import { expect, test } from 'claude-code/testing'

const HOME = '/home/u'
const ROOT = '/home/u/code/app'
const NOW = 1_800_000_000_000

const claudeFile = (pid: number, id: string, cwd: string, name: string, status: string) =>
  JSON.stringify({ pid, sessionId: id, cwd, name, status, statusUpdatedAt: NOW - 60_000 })

const FILES: Record<string, string> = {
  [`${HOME}/.claude/sessions/1.json`]: claudeFile(1, 'self', ROOT, 'This session', 'busy'),
  [`${HOME}/.claude/sessions/2.json`]: claudeFile(2, 'peer', `${ROOT}/web`, 'Peer in subfolder', 'busy'),
  [`${HOME}/.claude/sessions/3.json`]: claudeFile(3, 'home', HOME, 'Opened at home', 'idle'),
  [`${HOME}/.claude/sessions/4.json`]: claudeFile(4, 'dead', ROOT, 'Exited session', 'idle'),
  [`${HOME}/.claude/sessions/5.json`]: claudeFile(5, 'other', '/home/u/code/other', 'Other repo', 'busy'),
}
const CODEX = `${HOME}/.codex/sessions/2027/01/15/rollout-x-01a0fd8e-19ab-74f0-a4d2-1819a8d4df95.jsonl`

// Answers the engine calls the mod makes, beneath the plugin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeHost = (on: any) => {
  on('session.root', () => ROOT)
  on('session.id', () => 'self')
  on('clock.now', () => NOW)
  on('clock.every', () => undefined)
  on('agent.list', () => [{ id: 'a1', description: 'Explore auth flow', type: 'Explore', status: 'running' }])
  on('fs.exists', () => true)
  on('fs.list', () =>
    Object.keys(FILES).map(p => ({ name: p.split('/').pop(), kind: 'file', size: 1, mtimeMs: NOW, isLink: false })),
  )
  on('fs.read', (_$: unknown, e: { path: string }) => FILES[e.path] ?? '')
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const [cmd, ...args] = e.argv
    const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
    if (cmd === 'printenv') return ok(`${HOME}\n`)
    if (cmd === 'ps') return ok('1\n2\n3\n5\n')
    if (cmd === 'git' && args.includes('--git-common-dir')) {
      const cwd = args[1] ?? ''
      return cwd.startsWith(ROOT) ? ok(`${ROOT}/.git\n`) : { exitCode: 128, stdout: '', stderr: '' }
    }
    if (cmd === 'git' && args.includes('--show-current')) return ok('main\n')
    if (cmd === 'find') return ok(`${Math.floor(NOW / 1000) - 5} ${CODEX}\n`)
    if (cmd === 'tail') return ok(`{"id":"01a0fd8e-19ab-74f0-a4d2-1819a8d4df95","thread_name":"Codex fixtures"}\n`)
    if (cmd === 'head') return ok(`{"type":"session_meta","payload":{"cwd":"${ROOT}"}}`)
    return { exitCode: 1, stdout: '', stderr: '' }
  })
}

const PANE_PROPS = { title: 'Sessions here', isFocused: false, bodyColumns: 50, placement: 'dock' } as never
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never

test('pane lists matching sessions on desktop and terminal', async ($, on) => {
  fakeHost(on)
  await $.command.run({ command: 'sessions-pane', args: '' } as never)

  const desktop = await $.ui.mount({ plugin: 'repo-sessions', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'repo-sessions' })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const source = String(svg?.props.source)
  expect(source).toContain('This session (this)')
  expect(source).toContain('Peer in subfolder')
  expect(source).toContain('Codex fixtures')
  expect(source).toContain('Explore auth flow')
  expect(source).not.toContain('Opened at home')
  expect(source).not.toContain('Exited session')
  expect(source).not.toContain('Other repo')
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'repo-sessions', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'repo-sessions' })
  expect(await terminal.find({ type: 'Text', text: /Peer in subfolder/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /Opened at home/ })).toBeUndefined()
  await terminal.unmount()
})

test('strip shows the other sessions on both surfaces', async ($, on) => {
  fakeHost(on)
  await $.command.run({ command: 'sessions-pane', args: '' } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ plugin: 'repo-sessions', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const found = surface === 'desktop'
      ? String((await band.find({ type: 'Svg' }))?.props.source)
      : (await band.find({ type: 'Text', text: /Peer in subfolder/ }))?.text ?? ''
    expect(await band.find({ key: 'toggle' })).toBeDefined()
    expect(found).toContain('Peer in subfolder')
    expect(found).not.toContain('This session')
    expect(found).not.toContain('Opened at home')
    await band.unmount()
  }
})
