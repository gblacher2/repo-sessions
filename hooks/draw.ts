import type { Peer, Snapshot } from '../types'

// Pure drawing helpers: no `$`, so they can be rendered outside Claude Code.

export const HISTORY_BUCKETS = 40
export const BUCKET_MS = 15_000

const W = 360
const ROW_H = 58
const SUB_H = 22
const PAD = 12
const STRIP_W = HISTORY_BUCKETS * 3

const AGENT = {
  claude: { label: 'Claude', color: '#D97757' },
  codex: { label: 'Codex', color: '#5B8DEF' },
} as const

const STYLE = `
  .fg { fill: #1f1f1e; } .mut { fill: #73726c; } .faint { fill: #73726c; opacity: .18; }
  .card { fill: #1f1f1e; opacity: .035; } .line { stroke: #1f1f1e; opacity: .08; }
  .pill { fill: #1f1f1e; opacity: .07; }
  @media (prefers-color-scheme: dark) {
    .fg { fill: #ecebe6; } .mut { fill: #9c9a92; } .faint { fill: #9c9a92; opacity: .22; }
    .card { fill: #ffffff; opacity: .05; } .line { stroke: #ffffff; } .pill { fill: #ffffff; opacity: .09; }
  }
  text { font-family: ui-sans-serif, -apple-system, system-ui, sans-serif; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`

const BUSY = '#2FA86B'
const IDLE = '#9A988F'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Fits text to a pixel width, estimating glyph width from the font size.
export const fit = (s: string, px: number, size: number) => {
  const max = Math.max(1, Math.floor(px / (size * 0.56)))
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

const dot = (x: number, y: number, isBusy: boolean) =>
  isBusy
    ? `<circle cx="${x}" cy="${y}" r="5" fill="${BUSY}" opacity=".35">
         <animate attributeName="r" values="5;10;5" dur="1.6s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values=".35;0;.35" dur="1.6s" repeatCount="indefinite"/>
       </circle>
       <circle cx="${x}" cy="${y}" r="5" fill="${BUSY}"/>`
    : `<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${IDLE}" stroke-width="1.5"/>`

const strip = (x: number, y: number, history: readonly number[]) =>
  history
    .map((v, i) =>
      v
        ? `<rect x="${x + i * 3}" y="${y}" width="2" height="12" rx="1" fill="${BUSY}"/>`
        : `<rect x="${x + i * 3}" y="${y + 9}" width="2" height="3" rx="1" class="faint"/>`,
    )
    .join('')

const pill = (x: number, y: number, text: string, color?: string) => {
  const w = text.length * 6.2 + 12
  const bg = color
    ? `<rect x="${x}" y="${y}" width="${w}" height="16" rx="8" fill="${color}" opacity=".16"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="16" rx="8" class="pill"/>`
  const fg = color ? `fill="${color}"` : 'class="mut"'
  return { w, svg: `${bg}<text x="${x + 6}" y="${y + 11.5}" font-size="10.5" font-weight="600" ${fg}>${esc(text)}</text>` }
}

const row = (p: Peer, y: number, root: string, now: number, selfBranch: string | null) => {
  const isBusy = p.status === 'busy'
  const agent = AGENT[p.agent]
  const right = W - PAD
  const badge = pill(PAD + 20, y + 9, agent.label, agent.color)
  const nameX = PAD + 20 + badge.w + 6
  const state = `${p.status} ${ago(now - p.since)}`
  const stateW = state.length * 6.8
  const name = `${p.name}${p.isSelf ? ' (this)' : ''}`

  const meta: string[] = []
  let mx = PAD + 20
  if (p.branch && p.branch !== selfBranch) {
    const b = pill(mx, y + 32, fit(p.branch, 120, 10.5))
    meta.push(b.svg)
    mx += b.w + 6
  }
  const where = [p.isWorktree ? 'worktree' : '', relativeCwd(p.cwd, root)].filter(Boolean).join(' · ')
  if (where) {
    meta.push(`<text x="${mx}" y="${y + 44}" font-size="12" class="mut">${esc(fit(where, right - STRIP_W - 10 - mx, 12))}</text>`)
  }

  return `<g>
    <title>${esc(`${agent.label} · ${p.name}\n${p.cwd}${p.branch ? `\n${p.branch}` : ''}`)}</title>
    <rect x="4" y="${y + 2}" width="${W - 8}" height="${ROW_H - 4}" rx="10" class="card"/>
    ${dot(PAD + 6, y + 17, isBusy)}
    ${badge.svg}
    <text x="${nameX}" y="${y + 21.5}" font-size="14" font-weight="${isBusy ? 650 : 500}" class="fg">${esc(fit(name, right - stateW - 10 - nameX, 14))}</text>
    <text x="${right}" y="${y + 21.5}" font-size="12" text-anchor="end" ${isBusy ? `fill="${BUSY}" font-weight="600"` : 'class="mut"'}>${state}</text>
    ${strip(right - STRIP_W, y + 34, p.history)}
    ${meta.join('')}
  </g>`
}

export function paneSvg(snap: Snapshot) {
  const busy = snap.peers.filter(p => p.status === 'busy').length
  const idle = snap.peers.length - busy
  const repo = snap.root.split('/').pop() ?? snap.root
  const parts: string[] = []
  let y = 0

  const selfBranch = snap.peers.find(p => p.isSelf)?.branch ?? null
  const repoText = fit(repo, 150, 15)
  parts.push(`<text x="${PAD}" y="19" font-size="15" font-weight="650" class="fg">${esc(repoText)}</text>`)
  if (selfBranch) parts.push(pill(PAD + repoText.length * 8.6 + 8, 6, fit(selfBranch, 90, 10.5)).svg)
  const i = pill(0, 0, `${idle} idle`)
  const b = pill(0, 0, `${busy} busy`, BUSY)
  const bx = W - PAD - i.w - 6 - b.w
  parts.push(pill(bx, 6, `${busy} busy`, BUSY).svg, pill(bx + b.w + 6, 6, `${idle} idle`).svg)
  parts.push(`<text x="${W - PAD}" y="${38}" font-size="10" text-anchor="end" class="mut">10 min</text>`)
  y = 44

  for (const p of snap.peers) {
    parts.push(row(p, y, snap.root, snap.checkedAt, selfBranch))
    y += ROW_H
  }

  if (snap.subagents.length > 0) {
    y += 8
    parts.push(`<line x1="${PAD}" x2="${W - PAD}" y1="${y}" y2="${y}" class="line"/>`)
    y += 18
    parts.push(`<text x="${PAD}" y="${y}" font-size="11" font-weight="650" class="mut">Subagents</text>`)
    y += 6
    for (const a of snap.subagents) {
      parts.push(`<g><title>${esc(`${a.type} · ${a.label}`)}</title>
        ${dot(PAD + 6, y + 11, true)}
        <text x="${PAD + 20}" y="${y + 15}" font-size="12" class="fg">${esc(fit(a.label, 220, 12))}</text>
        <text x="${W - PAD}" y="${y + 15}" font-size="11" text-anchor="end" class="mut">${esc(fit(a.type, 90, 11))}</text></g>`)
      y += SUB_H
    }
  }

  const h = y + 8
  return {
    width: W,
    height: h,
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}"><style>${STYLE}</style>${parts.join('')}</svg>`,
  }
}

// Compact chips for the band above the prompt: one per busy session elsewhere.
export function bandSvg(peers: readonly Peer[]) {
  const parts: string[] = []
  let x = 2
  for (const p of peers) {
    const agent = AGENT[p.agent]
    const label = fit(p.name, 150, 11.5)
    const w = label.length * 6.4 + 54 + agent.label.length * 6
    parts.push(`<g><title>${esc(`${agent.label} · ${p.name}\n${p.cwd}`)}</title>
      <rect x="${x}" y="2" width="${w}" height="24" rx="12" class="card"/>
      ${dot(x + 13, 14, p.status === 'busy')}
      <text x="${x + 24}" y="18" font-size="11" font-weight="650" fill="${agent.color}">${agent.label}</text>
      <text x="${x + 30 + agent.label.length * 6.4}" y="18" font-size="11.5" class="fg">${esc(label)}</text></g>`)
    x += w + 6
  }
  const width = Math.max(x, 10)
  return {
    width,
    height: 28,
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 28" width="${width}" height="28"><style>${STYLE}</style>${parts.join('')}</svg>`,
  }
}

// Terminal version of the activity strip.
export const stripText = (history: readonly number[]) => history.map(v => (v ? '█' : '·')).join('')
