import type { Peer, Snapshot } from '../types'

// Pure drawing helpers: no `$`, so they can be rendered outside Claude Code.
// Pixel style: labels in a 5x7 bitmap font, square marks, notched boxes,
// one block per 15 s on the timeline, all drawn with crisp edges.

export const HISTORY_BUCKETS = 40
export const BUCKET_MS = 15_000

const PAD = 12
const ROW_H = 46
const SUB_H = 26

// Agent identity: categorical slots 1 and 2, validated for both modes.
const AGENT = {
  claude: { label: 'Claude', light: '#eb6834', dark: '#d95926' },
  codex: { label: 'Codex', light: '#2a78d6', dark: '#3987e5' },
} as const
const GOOD = '#0ca30c'

const STYLE = `
  .t1 { fill: #0b0b0b; } .t2 { fill: #52514e; } .t3 { fill: #8a8880; }
  .edge { stroke: #0b0b0b; stroke-opacity: .16; fill: none; } .grid { stroke: #0b0b0b; stroke-opacity: .12; }
  .off { fill: #0b0b0b; fill-opacity: .13; } .ring { stroke: #8a8880; fill: none; }
  .self, .chip { fill: #0b0b0b; } .self { fill-opacity: .04; } .chip { fill-opacity: .045; }
  .claude { fill: ${AGENT.claude.light}; } .codex { fill: ${AGENT.codex.light}; }
  @media (prefers-color-scheme: dark) {
    .t1 { fill: #f2f1ec; } .t2 { fill: #c3c2b7; } .t3 { fill: #8f8d85; }
    .edge, .grid { stroke: #ffffff; } .edge { stroke-opacity: .16; } .grid { stroke-opacity: .1; }
    .off { fill: #ffffff; fill-opacity: .14; } .ring { stroke: #8f8d85; }
    .self, .chip { fill: #ffffff; } .self { fill-opacity: .045; } .chip { fill-opacity: .06; }
    .claude { fill: ${AGENT.claude.dark}; } .codex { fill: ${AGENT.codex.dark}; }
  }
  text { font-family: "SF Mono", ui-monospace, Menlo, Monaco, monospace; }
`

// 5x7 bitmap glyphs, one string of five bits per row.
const GLYPHS: Record<string, string> = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111', '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
  '-': '00000000000000011111000000000000000', '/': '00001000010001000100010001000010000',
  '.': '00000000000000000000000000110001100', ':': '00000011000110000000011000110000000',
  '+': '00000001000010011111001000010000000', '_': '00000000000000000000000000000011111',
  '·': '00000000000000000100000000000000000', '?': '01110100010000100010001000000000100',
  ' ': '00000000000000000000000000000000000',
}

// Draws `text` in the bitmap font with its top-left at (x, y); `px` is the
// size of one font pixel. Lit runs in each row become one path.
export function pixelText(x: number, y: number, text: string, px: number, cls: string) {
  const d: string[] = []
  const chars = [...text.toUpperCase()]
  chars.forEach((ch, i) => {
    const bits = GLYPHS[ch] ?? GLYPHS['?']!
    const gx = x + i * 6 * px
    for (let row = 0; row < 7; row++) {
      let col = 0
      while (col < 5) {
        if (bits[row * 5 + col] !== '1') {
          col++
          continue
        }
        const start = col
        while (col < 5 && bits[row * 5 + col] === '1') col++
        d.push(`M${+(gx + start * px).toFixed(2)} ${+(y + row * px).toFixed(2)}h${+((col - start) * px).toFixed(2)}v${px}h${-((col - start) * px).toFixed(2)}z`)
      }
    }
  })
  return { svg: `<path d="${d.join('')}" class="${cls}"/>`, width: chars.length * 6 * px - px }
}

export const pixelWidth = (text: string, px: number) => [...text].length * 6 * px - px

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Fits monospace text to a pixel width.
export const fit = (s: string, px: number, size: number) => {
  const max = Math.max(1, Math.floor(px / (size * 0.61)))
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
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"${
    isFixed ? ` width="${width}" height="${height}"` : ''
  }><style>${STYLE}</style>${body}</svg>`

// A box with its corners notched by one step, as in pixel art.
const notched = (x: number, y: number, w: number, h: number, cls: string, n = 2) =>
  `<path d="M${x + n} ${y}h${w - 2 * n}v${n}h${n}v${h - 2 * n}h${-n}v${n}h${-(w - 2 * n)}v${-n}h${-n}v${-(h - 2 * n)}h${n}z" class="${cls}"/>`

// Status: a blinking filled square for busy, a hollow square for idle.
const statusMark = (cx: number, cy: number, isBusy: boolean) =>
  isBusy
    ? `<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="${GOOD}">
         <animate attributeName="opacity" values="1;1;.25" keyTimes="0;.6;1" calcMode="discrete" dur="1.2s" repeatCount="indefinite"/>
       </rect>`
    : `<rect x="${cx - 2.5}" y="${cy - 2.5}" width="5" height="5" class="ring" stroke-width="1"/>`

const agentMark = (x: number, y: number, agent: Peer['agent']) =>
  `<rect x="${x}" y="${y}" width="6" height="6" class="${agent}"/>`

// Geometry for one drawing width: the shared time lane (last 10 minutes,
// left to right) takes the right-hand part, one cell per bucket.
type Geo = { W: number; LX: number; RX: number; CELL: number }
const geo = (W: number): Geo => {
  const RX = W - PAD
  const CELL = Math.max(3, Math.floor(Math.min(300, W * 0.34) / HISTORY_BUCKETS))
  return { W, LX: RX - CELL * HISTORY_BUCKETS, RX, CELL }
}

const lane = (g: Geo, y: number, history: readonly number[], agent: Peer['agent']) =>
  history
    .map((v, i) => {
      const x = g.LX + i * g.CELL
      return v
        ? `<rect x="${x}" y="${y - 4}" width="${g.CELL - 1}" height="8" class="${agent}"/>`
        : `<rect x="${x + (g.CELL - 2) / 2}" y="${y - 1}" width="2" height="2" class="off"/>`
    })
    .join('')

const sessionRow = (g: Geo, p: Peer, y: number, snap: Snapshot, selfBranch: string | null) => {
  const isBusy = p.status === 'busy'
  const textX = PAD + 14
  const textW = g.LX - 14 - textX

  const meta = [
    p.isSelf ? 'you' : '',
    AGENT[p.agent].label.toLowerCase(),
    `${p.status} ${ago(snap.checkedAt - p.since)}`,
    p.branch && p.branch !== selfBranch ? p.branch : '',
    p.isWorktree ? 'worktree' : '',
    relativeCwd(p.cwd, snap.root),
  ].filter(Boolean).join(' · ')

  return `
    ${p.isSelf ? notched(2, y + 2, g.W - 4, ROW_H - 4, 'self', 3) : ''}
    ${statusMark(PAD + 3, y + 16, isBusy)}
    <text x="${textX}" y="${y + 20}" font-size="12.5" font-weight="${isBusy ? 700 : 500}" class="t1">${esc(fit(p.name, textW, 12.5))}</text>
    ${agentMark(textX, y + 28, p.agent)}
    <text x="${textX + 11}" y="${y + 34}" font-size="10.5" class="t2">${esc(fit(meta, textW - 11, 10.5))}</text>
    ${lane(g, y + ROW_H / 2, p.history, p.agent)}`
}

// The timeline: one row per session on a shared 10-minute axis. `width` is
// the drawing's width in CSS pixels; `isFixed` pins it rather than scaling.
export function paneSvg(snap: Snapshot, width = 360, options: { withHeader?: boolean; isFixed?: boolean } = {}) {
  const { withHeader = true, isFixed = false } = options
  const g = geo(width)
  const { W, LX, RX } = g
  const busy = snap.peers.filter(p => p.status === 'busy').length
  const idle = snap.peers.length - busy
  const selfBranch = snap.peers.find(p => p.isSelf)?.branch ?? null
  const agents = (['claude', 'codex'] as const).filter(a => snap.peers.some(p => p.agent === a))
  const parts: string[] = []

  if (withHeader) {
    const repo = snap.root.split('/').pop() ?? snap.root
    parts.push(pixelText(PAD, 10, repo, 2, 't1').svg)
    const sub = [selfBranch, `${busy} busy`, `${idle} idle`].filter(Boolean).join(' · ')
    parts.push(`<text x="${PAD}" y="42" font-size="11" class="t2">${esc(fit(sub, W - 2 * PAD, 11))}</text>`)
  }

  // Axis row: legend on the left, time ticks over the lane.
  const axisY = withHeader ? 58 : 8
  let lx = PAD
  for (const a of agents) {
    parts.push(agentMark(lx, axisY + 1, a))
    const label = pixelText(lx + 10, axisY, AGENT[a].label, 1.15, 't2')
    parts.push(label.svg)
    lx += 10 + label.width + 14
  }
  const mid = LX + (RX - LX) / 2
  parts.push(pixelText(LX, axisY, '10m', 1.15, 't3').svg)
  parts.push(pixelText(mid - pixelWidth('5m', 1.15) / 2, axisY, '5m', 1.15, 't3').svg)
  parts.push(pixelText(RX - pixelWidth('now', 1.15), axisY, 'now', 1.15, 't3').svg)

  let y = axisY + 14
  const rowsTop = y
  const rows: string[] = []
  snap.peers.forEach(p => {
    rows.push(sessionRow(g, p, y, snap, selfBranch))
    y += ROW_H
  })
  for (const gx of [LX, Math.round(mid), RX]) {
    parts.push(`<line x1="${gx - 0.5}" x2="${gx - 0.5}" y1="${rowsTop + 4}" y2="${y - 4}" class="grid" stroke-dasharray="1 3"/>`)
  }
  parts.push(...rows)

  if (snap.subagents.length > 0) {
    y += 12
    parts.push(pixelText(PAD, y, 'subagents', 1.15, 't3').svg)
    y += 10
    for (const a of snap.subagents) {
      parts.push(`${statusMark(PAD + 3, y + 12, true)}
        <text x="${PAD + 14}" y="${y + 16}" font-size="12" class="t1">${esc(fit(a.label, W - 120, 12))}</text>
        <text x="${RX}" y="${y + 16}" font-size="10.5" text-anchor="end" class="t2">${esc(fit(a.type, 80, 10.5))}</text>`)
      y += SUB_H
    }
  }

  const h = y + 8
  return { width: W, height: h, source: svg(W, h, parts.join(''), isFixed) }
}

// One-line summary for the band: repository, counts, then a chip per other
// session (busy first), folding what does not fit into "+N".
export function summarySvg(snap: Snapshot, maxWidth = 700) {
  const others = snap.peers.filter(p => !p.isSelf)
  const busy = others.filter(p => p.status === 'busy').length
  const H = 30
  const repo = pixelText(2, 8, (snap.root.split('/').pop() ?? snap.root).slice(0, 22), 2, 't1')
  const counts = pixelText(2 + repo.width + 12, 12, `${busy} busy · ${others.length - busy} idle`, 1.15, 't2')
  const parts: string[] = [repo.svg, counts.svg]
  let x = 2 + repo.width + 12 + counts.width + 14

  const chips = others.map(p => {
    const isBusy = p.status === 'busy'
    const name = fit(p.name, isBusy ? 170 : 130, 12)
    const time = ago(snap.checkedAt - p.since)
    return { p, isBusy, name, time, w: 30 + name.length * 12 * 0.61 + 10 + pixelWidth(time, 1.15) + 10 }
  })
  let shown = 0
  chips.forEach((c, i) => {
    const rest = chips.length - i - 1
    if (x + c.w + (rest > 0 ? 40 : 0) > maxWidth) return
    const w = Math.round(c.w)
    parts.push(`${notched(x, 2, w, 26, 'chip')}${notched(x + 0.5, 2.5, w - 1, 25, 'edge')}
      ${statusMark(x + 11, 15, c.isBusy)}
      ${agentMark(x + 19, 12, c.p.agent)}
      <text x="${x + 30}" y="19" font-size="12" font-weight="${c.isBusy ? 700 : 500}" class="${c.isBusy ? 't1' : 't2'}">${esc(c.name)}</text>
      ${pixelText(x + w - 10 - pixelWidth(c.time, 1.15), 11, c.time, 1.15, 't3').svg}`)
    x += w + 6
    shown++
  })
  if (shown < chips.length) {
    const more = pixelText(x + 4, 11, `+${chips.length - shown}`, 1.15, 't2')
    parts.push(more.svg)
    x += 4 + more.width + 6
  }
  const width = Math.ceil(x)
  return { width, height: H, source: svg(width, H, parts.join(''), true) }
}

// Terminal version of the lane.
export const stripText = (history: readonly number[]) => history.map(v => (v ? '█' : '·')).join('')
