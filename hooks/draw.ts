import type { Peer, Snapshot } from '../types'

// Pure drawing helpers: no `$`, so they can be rendered outside Claude Code.
// Pixel style: labels in a 5x7 bitmap font, a pixel sprite per agent, and
// one block per 15 s on the timeline, all drawn with crisp edges.

export const HISTORY_BUCKETS = 40
export const BUCKET_MS = 15_000

const PAD = 10

// Agent identity: categorical slots 1 and 2, validated for both modes.
const AGENT = {
  claude: { label: 'Claude', light: '#eb6834', dark: '#d95926' },
  codex: { label: 'Codex', light: '#2a78d6', dark: '#3987e5' },
} as const

const STYLE = `
  .t1 { fill: #0b0b0b; } .t2 { fill: #52514e; } .t3 { fill: #8a8880; }
  .edge { stroke: #0b0b0b; stroke-opacity: .16; fill: none; } .grid { stroke: #0b0b0b; stroke-opacity: .12; }
  .off { fill: #0b0b0b; fill-opacity: .13; } .ring { stroke: #8a8880; fill: none; }
  .self, .chip { fill: #0b0b0b; } .self { fill-opacity: .04; } .chip { fill-opacity: .045; }
  .claude { fill: ${AGENT.claude.light}; } .codex { fill: ${AGENT.codex.light}; } .eye { fill: #1a1a19; }
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

// Pixel sprites, one per agent: rows of `x` (body), `e` (eye), `.` (empty).
// Busy sprites walk (two leg frames and a bob); idle ones nap with closed
// eyes and a rising "z".
const SPRITES = {
  claude: {
    awake: ['..xxxxx..', '.xxxxxxx.', '.xexxxex.', 'xxxxxxxxx', '.xxxxxxx.'],
    asleep: ['..xxxxx..', '.xxxxxxx.', '.xeexeex.', 'xxxxxxxxx', '.xxxxxxx.'],
    legs: ['.x.x.x.x.', 'x.x.x.x.x'],
  },
  codex: {
    awake: ['....x....', '.xxxxxxx.', '.xexxxex.', '.xxxxxxx.', '.xxeeexx.'],
    asleep: ['....x....', '.xxxxxxx.', '.xeexeex.', '.xxxxxxx.', '.xxxxxxx.'],
    legs: ['..x...x..', '...x.x...'],
  },
} as const
const SPRITE_W = 9
const SPRITE_H = 6

const pixels = (x: number, y: number, rows: readonly string[], px: number, ch: string, cls: string) => {
  const d: string[] = []
  rows.forEach((row, r) => {
    ;[...row].forEach((c, i) => {
      if (c === ch) d.push(`M${x + i * px} ${y + r * px}h${px}v${px}h${-px}z`)
    })
  })
  return d.length ? `<path d="${d.join('')}" class="${cls}"/>` : ''
}

// A sprite with its top-left at (x, y); `px` is one sprite pixel.
export function sprite(x: number, y: number, agent: Peer['agent'], isBusy: boolean, px = 1.5) {
  const s = SPRITES[agent]
  const body = isBusy ? s.awake : s.asleep
  const legsY = y + body.length * px
  const still = pixels(x, y, body, px, 'x', agent) + pixels(x, y, body, px, 'e', 'eye')
  if (!isBusy) {
    const zx = x + SPRITE_W * px + 1
    return `${still}${pixels(x, legsY, [s.legs[0]], px, 'x', agent)}
      <g class="t3">
        <path d="M0 0h3v1h-1v1h-1v1h2v1h-3v-1h1v-1h1v-1h-2z" transform="translate(${zx} ${y})">
          <animateTransform attributeName="transform" type="translate" values="${zx} ${y + 3};${zx + 2} ${y - 3}" dur="2.4s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite"/>
        </path>
      </g>`
  }
  const frame = (legs: string, isFirst: boolean) =>
    `<g>${pixels(x, legsY, [legs], px, 'x', agent)}
      <animate attributeName="opacity" values="${isFirst ? '1;0' : '0;1'}" calcMode="discrete" dur=".5s" repeatCount="indefinite"/></g>`
  return `<g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" calcMode="discrete" dur=".5s" repeatCount="indefinite"/>
      ${still}${frame(s.legs[0], true)}${frame(s.legs[1], false)}
    </g>`
}

const agentMark = (x: number, y: number, agent: Peer['agent']) =>
  `<rect x="${x}" y="${y}" width="5" height="5" class="${agent}"/>`

// Geometry for one drawing width: the shared time lane (last 10 minutes,
// left to right) takes the right-hand part, one cell per bucket.
type Geo = { W: number; LX: number; RX: number; CELL: number }
const geo = (W: number): Geo => {
  const RX = W - PAD
  const CELL = Math.max(3, Math.floor(Math.min(240, W * 0.4) / HISTORY_BUCKETS))
  return { W, LX: RX - CELL * HISTORY_BUCKETS, RX, CELL }
}

const lane = (g: Geo, y: number, history: readonly number[], agent: Peer['agent']) =>
  history
    .map((v, i) => {
      const x = g.LX + i * g.CELL
      return v
        ? `<rect x="${x}" y="${y - 3}" width="${g.CELL - 1}" height="6" class="${agent}"/>`
        : `<rect x="${x + Math.floor((g.CELL - 1) / 2)}" y="${y}" width="1" height="1" class="off"/>`
    })
    .join('')

const ROW = 24

const sessionRow = (g: Geo, p: Peer, y: number, snap: Snapshot, selfBranch: string | null) => {
  const isBusy = p.status === 'busy'
  const mid = y + ROW / 2
  const textX = PAD + 26
  const meta = [
    p.isSelf ? 'you' : '',
    ago(snap.checkedAt - p.since),
    p.branch && p.branch !== selfBranch ? p.branch : '',
    p.isWorktree ? 'worktree' : '',
    relativeCwd(p.cwd, snap.root),
  ].filter(Boolean).join(' · ')
  const nameW = Math.min(p.name.length * 11 * 0.61, (g.LX - 12 - textX) * 0.6)
  const name = fit(p.name, nameW, 11)
  const metaX = textX + name.length * 11 * 0.61 + 8

  return `
    ${p.isSelf ? `<rect x="2" y="${y + 1}" width="${g.W - 4}" height="${ROW - 2}" class="self"/>` : ''}
    ${sprite(PAD, mid - 6, p.agent, isBusy, 2)}
    <text x="${textX}" y="${mid + 4}" font-size="11" font-weight="${isBusy ? 700 : 500}" class="${isBusy ? 't1' : 't2'}">${esc(name)}</text>
    <text x="${metaX}" y="${mid + 4}" font-size="10" class="t3">${esc(fit(meta, g.LX - 12 - metaX, 10))}</text>
    ${lane(g, mid, p.history, p.agent)}`
}

// The timeline: one line per session on a shared 10-minute axis. `width` is
// the drawing's width in CSS pixels; `isFixed` pins it rather than scaling.
export function paneSvg(snap: Snapshot, width = 360, options: { withHeader?: boolean; isFixed?: boolean } = {}) {
  const { withHeader = true, isFixed = false } = options
  const g = geo(width)
  const { W, LX, RX } = g
  const busy = snap.peers.filter(p => p.status === 'busy').length
  const selfBranch = snap.peers.find(p => p.isSelf)?.branch ?? null
  const parts: string[] = []

  let axisY = 4
  if (withHeader) {
    const repo = pixelText(PAD, 8, snap.root.split('/').pop() ?? snap.root, 1.5, 't1')
    parts.push(repo.svg)
    parts.push(pixelText(PAD + repo.width + 10, 10, `${busy} busy · ${snap.peers.length - busy} idle`, 1, 't3').svg)
    axisY = 30
  }

  const mid = LX + (RX - LX) / 2
  parts.push(pixelText(LX, axisY, '10m', 1, 't3').svg)
  parts.push(pixelText(mid - pixelWidth('5m', 1) / 2, axisY, '5m', 1, 't3').svg)
  parts.push(pixelText(RX - pixelWidth('now', 1), axisY, 'now', 1, 't3').svg)

  let y = axisY + 9
  const rowsTop = y
  const rows: string[] = []
  for (const p of snap.peers) {
    rows.push(sessionRow(g, p, y, snap, selfBranch))
    y += ROW
  }
  for (const gx of [LX, Math.round(mid), RX]) {
    parts.push(`<line x1="${gx - 0.5}" x2="${gx - 0.5}" y1="${rowsTop + 3}" y2="${y - 3}" class="grid" stroke-dasharray="1 3"/>`)
  }
  parts.push(...rows)

  if (snap.subagents.length > 0) {
    y += 6
    parts.push(pixelText(PAD, y, 'subagents', 1, 't3').svg)
    y += 8
    for (const a of snap.subagents) {
      parts.push(`${sprite(PAD, y + 6, 'claude', true, 2)}
        <text x="${PAD + 26}" y="${y + 16}" font-size="11" class="t1">${esc(fit(a.label, W - 120, 11))}</text>
        <text x="${RX}" y="${y + 16}" font-size="10" text-anchor="end" class="t3">${esc(fit(a.type, 80, 10))}</text>`)
      y += ROW
    }
  }

  const h = y + 4
  return { width: W, height: h, source: svg(W, h, parts.join(''), isFixed) }
}

// The band's header: repository and counts of the other sessions.
export function summarySvg(snap: Snapshot) {
  const others = snap.peers.filter(p => !p.isSelf)
  const busy = others.filter(p => p.status === 'busy').length
  const H = 18
  const repo = pixelText(1, 5, (snap.root.split('/').pop() ?? snap.root).slice(0, 24), 1.15, 't1')
  const counts = pixelText(1 + repo.width + 8, 6, `${busy} busy · ${others.length - busy} idle`, 1, 't3')
  const width = Math.ceil(1 + repo.width + 8 + counts.width + 2)
  return { width, height: H, source: svg(width, H, repo.svg + counts.svg, true) }
}

// One sprite as its own drawing, for a chip.
export function spriteSvg(agent: Peer['agent'], isBusy: boolean) {
  const width = SPRITE_W * 2 + (isBusy ? 0 : 7)
  const height = 16
  return { width, height, source: svg(width, height, sprite(0, 3, agent, isBusy, 2), true) }
}

// A short label in the bitmap font as its own drawing.
export function pixelTextSvg(text: string, cls = 't3') {
  const t = pixelText(0, 4, text, 1, cls)
  const width = Math.ceil(t.width) + 1
  return { text, width, height: 14, source: svg(width, 14, t.svg, true) }
}

// A session name in the monospace face as its own drawing, for a chip that
// has no link to open.
export function nameSvg(name: string, isBusy: boolean) {
  const text = fit(name, 160, 11)
  const width = Math.ceil(text.length * 11 * 0.61) + 2
  return {
    text,
    width,
    height: 16,
    source: svg(width, 16, `<text x="0" y="12" font-size="11" font-weight="${isBusy ? 700 : 500}" class="${isBusy ? 't1' : 't2'}">${esc(text)}</text>`, true),
  }
}

// Estimated width of one chip in the band: sprite, name, time and gaps.
export const chipWidth = (name: string, time: string, isButton: boolean) =>
  SPRITE_W * 2 + 7 + 8 + (isButton ? name.length * 7.2 + 12 : Math.min(name.length, 26) * 11 * 0.61) + 8 + pixelWidth(time, 1) + 16

// Terminal version of the lane.
export const stripText = (history: readonly number[]) => history.map(v => (v ? '█' : '·')).join('')
