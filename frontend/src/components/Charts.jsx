import React, { useEffect, useRef, useState } from 'react'
import { fmt } from '../format.js'

// Gráficos SVG leves (sem dependências): linha, barras e dispersão — todos com tooltip no hover.

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const ticks = (min, max, n = 4) => {
  if (min === max) return [min]
  const step = (max - min) / n
  return Array.from({ length: n + 1 }, (_, i) => min + step * i)
}

const PAD = { l: 52, r: 12, t: 10, b: 24 }

export function LineChart({ data, x, y, height = 220, format = fmt.brl, label = 'Fechamento' }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const pts = data.filter((d) => d[y] != null)
  if (!pts.length) return <div className="empty">Sem dados</div>
  const ys = pts.map((d) => d[y])
  let min = Math.min(...ys), max = Math.max(...ys)
  const pad = (max - min) * 0.08 || max * 0.02
  min -= pad; max += pad
  const iw = w - PAD.l - PAD.r, ih = height - PAD.t - PAD.b
  const sx = (i) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw)
  const sy = (v) => PAD.t + ih - ((v - min) / (max - min)) * ih
  const path = pts.map((d, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(d[y]).toFixed(1)}`).join('')
  const xt = [0, Math.floor(pts.length / 3), Math.floor((2 * pts.length) / 3), pts.length - 1]

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * w
    const i = Math.round(((px - PAD.l) / iw) * (pts.length - 1))
    setHover(Math.max(0, Math.min(pts.length - 1, i)))
  }
  const h = hover != null ? pts[hover] : null

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={label}>
        {ticks(min, max).map((t) => (
          <g key={t}>
            <line className="gridline" x1={PAD.l} x2={w - PAD.r} y1={sy(t)} y2={sy(t)} />
            <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end">{fmt.num(t, t > 100 ? 0 : 2)}</text>
          </g>
        ))}
        {xt.map((i) => (
          <text key={i} x={sx(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}>
            {fmt.date(pts[i][x])}
          </text>
        ))}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
        {h && (
          <g>
            <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <circle cx={sx(hover)} cy={sy(h[y])} r="4.5" fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(sx(hover) / w) * 100}%`, top: sy(h[y]) - 6 }}>
          <b className="num">{format(h[y])}</b>
          <span className="muted">{fmt.date(h[x])}</span>
        </div>
      )}
    </div>
  )
}

export function BarChart({ data, x, y, height = 180, format = (v) => fmt.num(v, 4) }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  if (!data.length) return <div className="empty">Sem proventos no período</div>
  const max = Math.max(...data.map((d) => d[y])) * 1.1
  const iw = w - PAD.l - PAD.r, ih = height - PAD.t - PAD.b
  const bw = iw / data.length
  const sy = (v) => PAD.t + ih - (v / max) * ih
  const barW = Math.max(2, Math.min(28, bw - 2))
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${height}`} onMouseLeave={() => setHover(null)} role="img" aria-label="Proventos">
        {ticks(0, max, 3).map((t) => (
          <g key={t}>
            <line className="gridline" x1={PAD.l} x2={w - PAD.r} y1={sy(t)} y2={sy(t)} />
            <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end">{fmt.num(t, 2)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.l + bw * i + bw / 2
          const top = sy(d[y]), hgt = PAD.t + ih - top
          const r = Math.min(4, barW / 2, hgt)
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.l + bw * i} y={PAD.t} width={bw} height={ih} fill="transparent" />
              <path
                d={`M${cx - barW / 2},${PAD.t + ih} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${PAD.t + ih} Z`}
                fill="var(--series-1)" opacity={hover == null || hover === i ? 1 : 0.45}
              />
            </g>
          )
        })}
        {[0, data.length - 1].map((i) => (
          <text key={i} x={PAD.l + bw * i + bw / 2} y={height - 6} textAnchor={i ? 'end' : 'start'}>{fmt.date(data[i][x])}</text>
        ))}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${((PAD.l + bw * hover + bw / 2) / w) * 100}%`, top: sy(data[hover][y]) - 6 }}>
          <b className="num">R$ {format(data[hover][y])}</b>
          <span className="muted">{fmt.date(data[hover][x])}</span>
        </div>
      )}
    </div>
  )
}

// Dispersão com até 3 grupos (limite de cores distinguíveis por daltônicos em dispersão)
export function Scatter({ data, x, y, group, groups, xLabel, yLabel, height = 320, onPick, xFmt = fmt.num, yFmt = fmt.pct }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const pts = data.filter((d) => d[x] != null && d[y] != null)
  if (!pts.length) return <div className="empty">Sem dados</div>
  const xs = pts.map((d) => d[x]), ys = pts.map((d) => d[y])
  const [x0, x1] = [Math.min(...xs) * 0.95, Math.max(...xs) * 1.05]
  const [y0, y1] = [Math.min(0, ...ys), Math.max(...ys) * 1.08]
  const P = { ...PAD, b: 38, l: 48 }
  const iw = w - P.l - P.r, ih = height - P.t - P.b
  const sx = (v) => P.l + ((v - x0) / (x1 - x0)) * iw
  const sy = (v) => P.t + ih - ((v - y0) / (y1 - y0)) * ih
  const color = (d) => groups.find((g) => g.match(d[group]))?.color || 'var(--text-muted)'
  const h = hover != null ? pts[hover] : null
  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        {groups.map((g) => <span key={g.label}><i style={{ background: g.color }} />{g.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} onMouseLeave={() => setHover(null)} role="img" aria-label={`${yLabel} por ${xLabel}`}>
        {ticks(y0, y1).map((t) => (
          <g key={'y' + t}>
            <line className="gridline" x1={P.l} x2={w - P.r} y1={sy(t)} y2={sy(t)} />
            <text x={P.l - 6} y={sy(t) + 4} textAnchor="end">{fmt.num(t, 0)}</text>
          </g>
        ))}
        {ticks(x0, x1).map((t) => (
          <text key={'x' + t} x={sx(t)} y={P.t + ih + 16} textAnchor="middle">{fmt.num(t, 2)}</text>
        ))}
        {x0 < 1 && x1 > 1 && (
          <line x1={sx(1)} x2={sx(1)} y1={P.t} y2={P.t + ih} stroke="var(--text-muted)" strokeDasharray="4 4" />
        )}
        <text x={P.l + iw / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
        <text x={12} y={P.t + ih / 2} textAnchor="middle" transform={`rotate(-90 12 ${P.t + ih / 2})`}>{yLabel}</text>
        {pts.map((d, i) => (
          <circle
            key={d.codigo} cx={sx(d[x])} cy={sy(d[y])} r={hover === i ? 7 : 5}
            fill={color(d)} stroke="var(--surface-1)" strokeWidth="2" opacity={hover == null || hover === i ? 0.9 : 0.35}
            onMouseEnter={() => setHover(i)} onClick={() => onPick?.(d)} style={{ cursor: 'pointer' }}
          />
        ))}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(sx(h[x]) / w) * 100}%`, top: sy(h[y]) - 8 }}>
          <b>{h.ticker} <span className="muted">· {h[group]}</span></b>
          <span className="num">{xLabel}: {xFmt(h[x])} · {yLabel}: {yFmt(h[y])}</span>
        </div>
      )}
    </div>
  )
}

// carteiras no mesmo ponto viram um só marcador ("1, 2"); pesos iguais = losango vazado "="
function agrupar(carteiras) {
  const grupos = []
  carteiras.forEach((c, i) => {
    const x = c.metricas.volatilidade, y = c.metricas.retorno_anual
    const rot = c.chave === 'iguais' ? '=' : String(i + 1)
    const g = grupos.find((g) => Math.abs(g.x - x) < 0.05 && Math.abs(g.y - y) < 0.05)
    if (g) { g.rotulo += `, ${rot}`; g.nomes.push(c.nome) }
    else grupos.push({ x, y, rotulo: rot, nomes: [c.nome], vazado: c.chave === 'iguais' })
  })
  return grupos
}

// Fronteira eficiente: linha (volatilidade × retorno), ativos como pontos coloridos, carteiras como losangos rotulados
export function FrontierChart({ fronteira, ativos, carteiras, cores, height = 340 }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const pts = [
    ...fronteira.map((p) => ({ x: p.volatilidade, y: p.retorno })),
    ...ativos.map((a) => ({ x: a.volatilidade, y: a.retorno_anual })),
    ...carteiras.map((c) => ({ x: c.metricas.volatilidade, y: c.metricas.retorno_anual })),
  ]
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x0 = Math.max(0, Math.min(...xs) * 0.85), x1 = Math.max(...xs) * 1.08
  const yr = Math.max(...ys) - Math.min(...ys) || 1
  const y0 = Math.min(...ys) - yr * 0.1, y1 = Math.max(...ys) + yr * 0.12
  const P = { l: 48, r: 16, t: 12, b: 38 }
  const iw = w - P.l - P.r, ih = height - P.t - P.b
  const sx = (v) => P.l + ((v - x0) / (x1 - x0)) * iw
  const sy = (v) => P.t + ih - ((v - y0) / (y1 - y0)) * ih
  const path = fronteira.map((p, i) => `${i ? 'L' : 'M'}${sx(p.volatilidade).toFixed(1)},${sy(p.retorno).toFixed(1)}`).join('')
  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        <span><i style={{ background: 'var(--text-secondary)', borderRadius: 2, height: 2, width: 14 }} />Fronteira eficiente</span>
        {ativos.map((a, i) => <span key={a.ticker}><i style={{ background: cores[i] }} />{a.ticker}</span>)}
        <span>◆ carteiras otimizadas · ◇ pesos iguais</span>
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} onMouseLeave={() => setHover(null)} role="img" aria-label="Fronteira eficiente">
        {ticks(y0, y1).map((t) => (
          <g key={'y' + t}>
            <line className="gridline" x1={P.l} x2={w - P.r} y1={sy(t)} y2={sy(t)} />
            <text x={P.l - 6} y={sy(t) + 4} textAnchor="end">{fmt.num(t, 0)}%</text>
          </g>
        ))}
        {ticks(x0, x1).map((t) => <text key={'x' + t} x={sx(t)} y={P.t + ih + 16} textAnchor="middle">{fmt.num(t, 0)}%</text>)}
        <text x={P.l + iw / 2} y={height - 4} textAnchor="middle">Volatilidade anual</text>
        <text x={12} y={P.t + ih / 2} textAnchor="middle" transform={`rotate(-90 12 ${P.t + ih / 2})`}>Retorno anual</text>
        <path d={path} fill="none" stroke="var(--text-secondary)" strokeWidth="2" />
        {ativos.map((a, i) => (
          <g key={a.ticker} onMouseEnter={() => setHover({ x: a.volatilidade, y: a.retorno_anual, t: a.ticker })}>
            <circle cx={sx(a.volatilidade)} cy={sy(a.retorno_anual)} r="6" fill={cores[i]} stroke="var(--surface-1)" strokeWidth="2" />
            <text x={sx(a.volatilidade) + 9} y={sy(a.retorno_anual) + 4} style={{ fill: 'var(--text-secondary)' }}>{a.ticker}</text>
          </g>
        ))}
        {agrupar(carteiras).map((g) => {
          const cx = sx(g.x), cy = sy(g.y)
          return (
            <g key={g.rotulo} onMouseEnter={() => setHover({ x: g.x, y: g.y, t: g.nomes.join(' = ') })}>
              <rect x={cx - 5} y={cy - 5} width="10" height="10" transform={`rotate(45 ${cx} ${cy})`}
                fill={g.vazado ? 'var(--surface-1)' : 'var(--text-primary)'} stroke={g.vazado ? 'var(--text-primary)' : 'var(--surface-1)'} strokeWidth="2" />
              <text x={cx - 9} y={cy - 8} textAnchor="end" style={{ fill: 'var(--text-primary)', fontWeight: 600 }}>{g.rotulo}</text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: `${(sx(hover.x) / w) * 100}%`, top: sy(hover.y) - 8 }}>
          <b>{hover.t}</b>
          <span className="num">Retorno {fmt.num(hover.y)}% · Volat. {fmt.num(hover.x)}%</span>
        </div>
      )}
    </div>
  )
}

// Várias séries no mesmo eixo (sem eixo duplo). Crosshair com o valor de todas as séries no ponto.
export function MultiLineChart({ datas, series, height = 260, fmtY = (v) => fmt.num(v), refs = [], label = 'Gráfico' }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const n = datas.length
  const vals = series.flatMap((s) => Array.from(s.valores).filter(Number.isFinite))
  if (!n || !vals.length) return <div className="empty">Sem dados</div>
  let min = Math.min(...vals, ...refs.map((r) => r.y)), max = Math.max(...vals, ...refs.map((r) => r.y))
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1
  min -= pad; max += pad
  const P = { l: 56, r: 12, t: 10, b: 24 }
  const iw = w - P.l - P.r, ih = height - P.t - P.b
  const sx = (i) => P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
  const sy = (v) => P.t + ih - ((v - min) / (max - min)) * ih
  const caminho = (valores) => {
    let d = '', pen = false
    for (let i = 0; i < n; i++) {
      const v = valores[i]
      if (!Number.isFinite(v)) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`
      pen = true
    }
    return d
  }
  const xt = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]
  const casas = Math.abs(max) >= 1000 ? 0 : 2
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * w
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / iw) * (n - 1)))))
  }
  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.nome}>
              <i style={{ background: s.cor, ...(s.tracejado ? { borderRadius: 2, height: 2, width: 14, verticalAlign: 3 } : {}) }} />{s.nome}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${w} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={label}>
        {ticks(min, max).map((t) => (
          <g key={t}>
            <line className="gridline" x1={P.l} x2={w - P.r} y1={sy(t)} y2={sy(t)} />
            <text x={P.l - 6} y={sy(t) + 4} textAnchor="end">{fmt.num(t, casas)}</text>
          </g>
        ))}
        {refs.map((r) => (
          <g key={r.y}>
            <line x1={P.l} x2={w - P.r} y1={sy(r.y)} y2={sy(r.y)} stroke="var(--text-muted)" strokeDasharray="4 4" />
            {r.label && <text x={w - P.r} y={sy(r.y) - 4} textAnchor="end">{r.label}</text>}
          </g>
        ))}
        {xt.map((i, k) => (
          <text key={k} x={sx(i)} y={height - 6} textAnchor={k === 0 ? 'start' : k === 3 ? 'end' : 'middle'}>{fmt.date(datas[i])}</text>
        ))}
        {series.map((s) => (
          <path key={s.nome} d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth={s.tracejado ? 1.5 : 2}
            strokeDasharray={s.tracejado ? '5 4' : undefined} strokeLinejoin="round" />
        ))}
        {hover != null && (
          <g>
            <line x1={sx(hover)} x2={sx(hover)} y1={P.t} y2={P.t + ih} stroke="var(--text-muted)" strokeDasharray="3 3" />
            {series.map((s) => Number.isFinite(s.valores[hover]) && (
              <circle key={s.nome} cx={sx(hover)} cy={sy(s.valores[hover])} r="4" fill={s.cor} stroke="var(--surface-1)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${Math.min(85, Math.max(15, (sx(hover) / w) * 100))}%`, top: P.t + 4, transform: 'translate(-50%, 0)' }}>
          <span className="muted">{fmt.date(datas[hover])}</span>
          {series.map((s) => (
            <div key={s.nome} className="num" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: s.cor, marginRight: 6 }} />{s.nome}</span>
              <b style={{ display: 'inline' }}>{Number.isFinite(s.valores[hover]) ? fmtY(s.valores[hover]) : '—'}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
