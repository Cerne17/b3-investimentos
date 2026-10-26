import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { fmt } from '../format.js'

// Autocomplete de ETFs/FIIs da base; Enter sem sugestão usa o texto como ticker do Yahoo
export default function BuscaAtivo({ onAdd, label = 'Buscar ativo (ETF, FII ou qualquer ticker do Yahoo)', width = 320 }) {
  const [q, setQ] = useState('')
  const [sug, setSug] = useState([])
  const [hl, setHl] = useState(0)
  const [aberto, setAberto] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!q.trim()) { setSug([]); return }
    const t = setTimeout(() => api.busca(q.trim()).then((s) => { setSug(s); setHl(0) }).catch(() => {}), 200)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const fora = (e) => box.current && !box.current.contains(e.target) && setAberto(false)
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const escolher = (t) => { if (t) onAdd(t.toUpperCase()); setQ(''); setSug([]) }
  const onKey = (e) => {
    if (e.key === 'Escape') { setAberto(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, sug.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const s = sug[hl]
      escolher(s ? s.ticker || `${s.codigo}11` : q.trim())
    }
  }

  return (
    <div className="picker field" ref={box}>
      {label}
      <input className="wide" style={{ width }} value={q} placeholder="ex.: MXRF, ouro, logística, PETR4"
        onChange={(e) => { setQ(e.target.value); setAberto(true) }} onFocus={() => setAberto(true)} onKeyDown={onKey} />
      {aberto && q.trim() && (
        <div className="suggest">
          {sug.map((s, i) => (
            <button key={s.tipo + s.codigo} className={i === hl ? 'hl' : ''} onMouseEnter={() => setHl(i)}
              onClick={() => escolher(s.ticker || `${s.codigo}11`)}>
              <b>{s.ticker || s.codigo}</b>
              <span className="badge">{s.tipo}</span>
              <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nome_pregao} · {s.categoria}</span>
              <span className="num" style={{ marginLeft: 'auto' }}>{s.status === 'ok' ? fmt.brl(s.preco) : 'sem cotação'}</span>
            </button>
          ))}
          <button onClick={() => escolher(q.trim())}>
            <span className="muted">Usar “{q.trim().toUpperCase()}” direto do Yahoo</span>
          </button>
        </div>
      )}
    </div>
  )
}
