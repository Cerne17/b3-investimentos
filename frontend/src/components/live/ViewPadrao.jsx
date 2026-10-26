import React, { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { fmt, signClass, signed } from '../../format.js'
import { PriceChart } from '../Detail.jsx'

const PADRAO = ['BOVA11', 'IVVB11', 'HGLG11', 'KNRI11', 'MXRF11', '^BVSP']

const carregar = () => {
  try { return JSON.parse(localStorage.getItem('watchlist')) || PADRAO } catch { return PADRAO }
}

export default function ViewPadrao() {
  const [lista, setLista] = useState(carregar)
  const [cot, setCot] = useState({})
  const [sel, setSel] = useState(lista[0])
  const [novo, setNovo] = useState('')

  useEffect(() => {
    try { localStorage.setItem('watchlist', JSON.stringify(lista)) } catch {}
    const load = () => api.cotacoes(lista).then(setCot).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [lista])

  const add = (e) => {
    e.preventDefault()
    const t = novo.trim().toUpperCase()
    if (t && !lista.includes(t)) setLista([...lista, t])
    setSel(t || sel)
    setNovo('')
  }

  return (
    <>
      <form className="filters" onSubmit={add}>
        <label className="field">Adicionar ticker
          <input className="wide" value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="ex.: XPML11" />
        </label>
        <button className="btn primary">Adicionar</button>
      </form>
      <div className="grid kpis">
        {lista.map((t) => {
          const q = cot[t]
          return (
            <div key={t} className="card kpi" style={{ cursor: 'pointer', outline: sel === t ? '2px solid var(--accent)' : 'none' }} onClick={() => setSel(t)}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="label" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t}</span>
                <button className="chip" style={{ padding: '0 6px' }} aria-label={`Remover ${t}`}
                  onClick={(e) => { e.stopPropagation(); setLista(lista.filter((x) => x !== t)) }}>✕</button>
              </div>
              {q?.erro ? <div className="hint">{q.erro}</div> : (
                <>
                  <div className="value num">{q ? fmt.num(q.preco) : '…'}</div>
                  <div className={`num ${signClass(q?.variacao_pct)}`} style={{ fontSize: 13, fontWeight: 600 }}>{q ? signed(q.variacao_pct) : ''}</div>
                  <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q?.nome}</div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {sel && <PriceChart ticker={sel} />}
      {sel && cot[sel] && !cot[sel].erro && (
        <div className="section metric-grid">
          {[['Abertura', fmt.num(cot[sel].abertura)], ['Mín. dia', fmt.num(cot[sel].minima_dia)], ['Máx. dia', fmt.num(cot[sel].maxima_dia)],
            ['Fech. anterior', fmt.num(cot[sel].fechamento_anterior)], ['Volume', fmt.big(cot[sel].volume, '')], ['Volume médio', fmt.big(cot[sel].volume_medio, '')],
            ['Máx 52s', fmt.num(cot[sel].max_52s)], ['Mín 52s', fmt.num(cot[sel].min_52s)], ['MM 50d', fmt.num(cot[sel].media_50d)],
            ['MM 200d', fmt.num(cot[sel].media_200d)], ['P/L', fmt.num(cot[sel].pl, 1)], ['P/VP', fmt.num(cot[sel].pvp)],
            ['Valor de mercado', fmt.big(cot[sel].valor_mercado, '')], ['DY (Yahoo)', fmt.pct(cot[sel].dividend_yield_yahoo)]].map(([l, v]) => (
            <div className="metric" key={l}><div className="label">{l}</div><div className="value num">{v}</div></div>
          ))}
        </div>
      )}
    </>
  )
}
