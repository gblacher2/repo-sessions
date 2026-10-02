import type { Peer, Snapshot } from '../types'

// Pure drawing helpers: no `$`, so they can be rendered outside Claude Code.

export const HISTORY_BUCKETS = 40
export const BUCKET_MS = 15_000

const PAD = 12
const ROW_H = 46
const SUB_H = 26

// Geometry for one drawing width: the shared time lane (last 10 minutes,
// left to right) takes the right-hand part.
type Geo = { W: number; LX: number; RX: number; CELL: number }
const geo = (W: number): Geo => {
  const RX = W - PAD
  const LX = RX - Math.min(300, Math.round(W * 0.34))
  return { W, LX, RX, CELL: (RX - LX) / HISTORY_BUCKETS }
}

// Agent identity: categorical slots 1 and 2, validated for both modes.
const AGENT = {
  claude: { label: 'Claude', light: '#eb6834', dark: '#d95926' },
  codex: { label: 'Codex', light: '#2a78d6', dark: '#3987e5' },
} as const
const GOOD = '#0ca30c'

const STYLE = `
  .t1 { fill: #0b0b0b; } .t2 { fill: #52514e; } .t3 { fill: #8a8880; }
  .hair { stroke: #0b0b0b; stroke-opacity: .09; } .grid { stroke: #0b0b0b; stroke-opacity: .07; }
  .track { stroke: #0b0b0b; stroke-opacity: .12; } .ring { stroke: #8a8880; }
  .self { fill: #0b0b0b; fill-opacity: .035; } .chip { fill: #0b0b0b; fill-opacity: .05; }
  .claude { fill: ${AGENT.claude.light}; } .codex { fill: ${AGENT.codex.light}; }
  @media (prefers-color-scheme: dark) {
    .t1 { fill: #f2f1ec; } .t2 { fill: #c3c2b7; } .t3 { fill: #8f8d85; }
    .hair, .grid, .track { stroke: #ffffff; } .hair { stroke-opacity: .08; } .grid { stroke-opacity: .06; }
    .track { stroke-opacity: .14; } .ring { stroke: #8f8d85; }
    .self, .chip { fill: #ffffff; } .self { fill-opacity: .04; } .chip { fill-opacity: .07; }
    .claude { fill: ${AGENT.claude.dark}; } .codex { fill: ${AGENT.codex.dark}; }
  }
  text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif; }
  .caps { font-size: 9.5px; font-weight: 600; letter-spacing: .06em; }
  .num { font-variant-numeric: tabular-nums; }
`

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Fits text to a pixel width, estimating glyph width from the font size.
export const fit = (s: string, px: number, size: number) => {
  const max = Math.max(1, Math.floor(px / (size * 0.52)))
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export const relativeCwd = (cwd: string, root: string) =>
  cwd === root ? '' : cwd.startsWith(`${root}/`) ? `./${cwd.slice(root.length + 1)}` : cwd.split('/').pop() ?? cwd

const svg = (width: number, height: number, body: string, isFixed: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${
    isFixed ? ` width="${width}" height="${height}"` : ''
  }><style>${STYLE}</style>${body}</svg>`

// Status: a pulsing filled dot for busy, a hollow ring for idle.
const statusDot = (x: number, y: number, isBusy: boolean) =>
  isBusy
    ? `<circle cx="${x}" cy="${y}" r="3.5" fill="${GOOD}" opacity=".4">
         <animate attributeName="r" values="3.5;8;3.5" dur="1.8s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values=".4;0;.4" dur="1.8s" repeatCount="indefinite"/>
       </circle>
       <circle cx="${x}" cy="${y}" r="3.5" fill="${GOOD}"/>`
    : `<circle cx="${x}" cy="${y}" r="3" fill="none" class="ring" stroke-width="1.3"/>`

const agentMark = (x: number, y: number, agent: Peer['agent']) =>
  `<rect x="${x}" y="${y}" width="8" height="8" rx="2" class="${agent}"/>`

// Consecutive busy buckets joined into rounded spans on a hairline track.
const lane = (g: Geo, y: number, history: readonly number[], agent: Peer['agent']) => {
  const { LX, RX, CELL } = g
  const parts = [`<line x1="${LX}" x2="${RX}" y1="${y}" y2="${y}" class="track" stroke-width="1"/>`]
  let start = -1
  history.forEach((v, i) => {
    if (v && start < 0) start = i
    if ((!v || i === history.length - 1) && start >= 0) {
      const end = v ? i + 1 : i
      const x = LX + start * CELL
      const w = Math.max(3, (end - start) * CELL - 1)
      parts.push(`<rect x="${x.toFixed(1)}" y="${y - 4}" width="${w.toFixed(1)}" height="8" rx="3" class="${agent}"/>`)
      start = -1
    }
  })
  return parts.join('')
}

const sessionRow = (g: Geo, p: Peer, y: number, snap: Snapshot, selfBranch: string | null) => {
  const { W, LX } = g
  const isBusy = p.status === 'busy'
  const textX = PAD + 16
  const textW = LX - 14 - textX
  const name = p.name

  const meta = [
    p.isSelf ? 'You' : '',
    AGENT[p.agent].label,
    `${p.status} ${ago(snap.checkedAt - p.since)}`,
    p.branch && p.branch !== selfBranch ? p.branch : '',
    p.isWorktree ? 'worktree' : '',
    relativeCwd(p.cwd, snap.root),
  ].filter(Boolean).join('  ·  ')

  return `
    ${p.isSelf ? `<rect x="2" y="${y + 1}" width="${W - 4}" height="${ROW_H - 2}" rx="8" class="self"/>` : ''}
    ${statusDot(PAD + 4, y + 17, isBusy)}
    <text x="${textX}" y="${y + 21}" font-size="13" font-weight="${isBusy ? 600 : 500}" class="t1">${esc(fit(name, textW, 13))}</text>
    ${agentMark(textX, y + 29, p.agent)}
    <text x="${textX + 13}" y="${y + 36.5}" font-size="11" class="t2 num">${esc(fit(meta, textW - 13, 11))}</text>
    ${lane(g, y + ROW_H / 2, p.history, p.agent)}`
}

// The swimlane: one row per session on a shared 10-minute axis. `width` is
// the drawing's width in CSS pixels; `isFixed` pins it rather than scaling.
export function paneSvg(snap: Snapshot, width = 360, options: { withHeader?: boolean; isFixed?: boolean } = {}) {
  const { withHeader = true, isFixed = false } = options
  const g = geo(width)
  const { W, LX, RX } = g
  const busy = snap.peers.filter(p => p.status === 'busy').length
  const idle = snap.peers.length - busy
  const repo = snap.root.split('/').pop() ?? snap.root
  const selfBranch = snap.peers.find(p => p.isSelf)?.branch ?? null
  const agents = (['claude', 'codex'] as const).filter(a => snap.peers.some(p => p.agent === a))
  const parts: string[] = []

  // Header: repository, branch and counts.
  if (withHeader) parts.push(`<text x="${PAD}" y="22" font-size="16" font-weight="650" class="t1">${esc(fit(repo, W - 2 * PAD, 16))}</text>`)
  const sub = [selfBranch, `${busy} busy`, `${idle} idle`].filter(Boolean).join('  ·  ')
  if (withHeader) parts.push(`<text x="${PAD}" y="40" font-size="11.5" class="t2 num">${esc(fit(sub, W - 2 * PAD, 11.5))}</text>`)

  // Axis row: legend on the left, time ticks over the lane.
  const axisY = withHeader ? 66 : 16
  let lx = PAD
  for (const a of agents) {
    parts.push(agentMark(lx, axisY - 7.5, a))
    parts.push(`<text x="${lx + 12}" y="${axisY}" font-size="10.5" class="t2">${AGENT[a].label}</text>`)
    lx += 12 + AGENT[a].label.length * 6.2 + 12
  }
  const mid = (LX + RX) / 2
  parts.push(`<text x="${LX}" y="${axisY}" class="t3 caps">10M</text>`)
  parts.push(`<text x="${mid}" y="${axisY}" text-anchor="middle" class="t3 caps">5M</text>`)
  parts.push(`<text x="${RX}" y="${axisY}" text-anchor="end" class="t3 caps">NOW</text>`)

  let y = axisY + 8
  const rowsTop = y
  const rows: string[] = []
  snap.peers.forEach((p, i) => {
    if (i > 0 && !p.isSelf && !snap.peers[i - 1]?.isSelf) {
      rows.push(`<line x1="${PAD}" x2="${RX}" y1="${y}" y2="${y}" class="hair"/>`)
    }
    rows.push(sessionRow(g, p, y, snap, selfBranch))
    y += ROW_H
  })
  // Grid lines under the rows, spanning the lane.
  for (const gx of [LX, mid, RX]) {
    parts.push(`<line x1="${gx}" x2="${gx}" y1="${rowsTop + 4}" y2="${y - 4}" class="grid" stroke-dasharray="2 3"/>`)
  }
  parts.push(...rows)

  if (snap.subagents.length > 0) {
    y += 22
    parts.push(`<text x="${PAD}" y="${y}" class="t3 caps">SUBAGENTS</text>`)
    y += 6
    for (const a of snap.subagents) {
      parts.push(`${statusDot(PAD + 4, y + 13, true)}
        <text x="${PAD + 16}" y="${y + 17}" font-size="12.5" class="t1">${esc(fit(a.label, 230, 12.5))}</text>
        <text x="${RX}" y="${y + 17}" font-size="11" text-anchor="end" class="t2">${esc(fit(a.type, 80, 11))}</text>`)
      y += SUB_H
    }
  }

  const h = y + 10
  return { width: W, height: h, source: svg(W, h, parts.join(''), isFixed) }
}

// One-line summary for the band: repository, counts, then a chip per other
// session (busy first), folding what does not fit into "+N".
export function summarySvg(snap: Snapshot, maxWidth = 700) {
  const others = snap.peers.filter(p => !p.isSelf)
  const busy = others.filter(p => p.status === 'busy').length
  const repo = fit(snap.root.split('/').pop() ?? snap.root, 160, 13)
  const counts = `${busy} busy · ${others.length - busy} idle`
  const parts: string[] = [
    `<text x="2" y="19" font-size="13" font-weight="650" class="t1">${esc(repo)}</text>`,
    `<text x="${2 + repo.length * 7.8 + 8}" y="19" font-size="11.5" class="t2 num">${counts}</text>`,
  ]
  let x = 2 + repo.length * 7.8 + 8 + counts.length * 6.3 + 14

  const chips = others.map(p => {
    const isBusy = p.status === 'busy'
    const name = fit(p.name, isBusy ? 170 : 120, 12)
    const time = ago(snap.checkedAt - p.since)
    return { p, isBusy, name, time, w: 35 + name.length * (isBusy ? 7.1 : 6.7) + 10 + time.length * 6.2 + 12 }
  })
  chips.forEach((c, i) => {
    const rest = chips.length - i - 1
    if (x + c.w + (rest > 0 ? 44 : 0) > maxWidth) return
    parts.push(`<rect x="${x}" y="2" width="${c.w}" height="26" rx="13" class="chip"/>
      ${statusDot(x + 13, 15, c.isBusy)}
      ${agentMark(x + 22, 11, c.p.agent)}
      <text x="${x + 35}" y="19.5" font-size="12" font-weight="${c.isBusy ? 600 : 450}" class="${c.isBusy ? 't1' : 't2'}">${esc(c.name)}</text>
      <text x="${x + c.w - 12}" y="19.5" font-size="11" text-anchor="end" class="t3 num">${c.time}</text>`)
    x += c.w + 6
  })
  const shown = parts.filter(s => s.startsWith('<rect')).length
  if (shown < chips.length) {
    parts.push(`<text x="${x + 4}" y="19.5" font-size="11.5" class="t2">+${chips.length - shown}</text>`)
    x += 34
  }
  const width = Math.ceil(x)
  return { width, height: 30, source: svg(width, 30, parts.join(''), true) }
}

// Terminal version of the lane.
export const stripText = (history: readonly number[]) => history.map(v => (v ? '━' : '─')).join('')
