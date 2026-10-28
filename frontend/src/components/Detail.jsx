import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { GRUPOS, LABELS } from '../config.js'
import { colClass, fmt, formatCol, signClass, signed } from '../format.js'
import { BarChart, LineChart } from './Charts.jsx'
import { intervaloPadrao, PERIODOS as TODOS, TITULOS } from './live/comum.jsx'

const PERIODOS = TODOS.filter(([p]) => !['3mo', 'max'].includes(p))


export function PriceChart({ ticker }) {
  const [periodo, setPeriodo] = useState('1y')
  const [hist, setHist] = useState(null)
  const [erro, setErro] = useState(null)
  useEffect(() => {
    setHist(null); setErro(null)
    api.historico(ticker, periodo, intervaloPadrao(periodo)).then(setHist).catch((e) => setErro(e.message))
  }, [ticker, periodo])
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Preço de fechamento · {ticker}</h2>
        <div className="seg">
          {PERIODOS.map(([p, l]) => <button key={p} className={p === periodo ? 'on' : ''} title={TITULOS[p]} onClick={() => setPeriodo(p)}>{l}</button>)}
        </div>
      </div>
      {erro ? <div className="empty">{erro}</div> : hist ? <LineChart data={hist} x="data" y="fechamento" /> : <div className="empty">Carregando…</div>}
    </div>
  )
}

export function LiveQuote({ ticker, compact }) {
  const [q, setQ] = useState(null)
  const [erro, setErro] = useState(null)
  useEffect(() => {
    let vivo = true
    const load = () => api.cotacao(ticker).then((d) => vivo && setQ(d)).catch((e) => vivo && setErro(e.message))
    load()
    const id = setInterval(load, 30000) // atualiza a cada 30 s
    return () => { vivo = false; clearInterval(id) }
  }, [ticker])
  if (erro) return <div className="alert">{erro}</div>
  if (!q) return <div className="muted">Buscando cotação ao vivo…</div>
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="price-big num">{fmt.preco(q.preco)}</span>
        <span className={`num ${signClass(q.variacao_pct)}`} style={{ fontWeight: 600 }}>
          {q.variacao_pct > 0 ? '▲' : q.variacao_pct < 0 ? '▼' : ''} {signed(q.variacao_pct)} ({fmt.num(q.variacao)})
        </span>
        <span className="badge">{q.ticker_usd ? 'Mercado 24h' : q.estado_mercado === 'REGULAR' ? 'Mercado aberto' : 'Mercado fechado'}</span>
      </div>
      {!compact && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Abertura {fmt.preco(q.abertura)} · Mín {fmt.preco(q.minima_dia)} · Máx {fmt.preco(q.maxima_dia)} · Volume {fmt.big(q.volume, q.ticker_usd ? 'R$ ' : '')}
          {q.ticker_usd && ` · ${q.ticker_usd} × US$ ${fmt.num(q.cambio, 4)}`}
          {q.horario && ` · ${new Date(q.horario).toLocaleString('pt-BR')}`} · Yahoo Finance
        </div>
      )}
    </div>
  )
}

export default function Detail({ tipo, codigo, onClose }) {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState(null)
  const [atualizando, setAtualizando] = useState(false)
  const [somenteLeitura, setSomenteLeitura] = useState(true)

  useEffect(() => { fetch('/api/saude').then((r) => r.json()).then((d) => setSomenteLeitura(!!d.somente_leitura)).catch(() => {}) }, [])

  useEffect(() => {
    setD(null)
    api.obter(tipo, codigo).then(setD).catch((e) => setErro(e.message))
  }, [tipo, codigo])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const atualizar = async () => {
    setAtualizando(true)
    try { setD(await api.atualizar(tipo, codigo)) } catch (e) { setErro(e.message) } finally { setAtualizando(false) }
  }

  const ticker = d?.ticker || (tipo === 'acoes' ? codigo : tipo === 'criptos' ? `${codigo}-BRL` : `${codigo}11`)
  const provs = (d?.proventos_recentes || []).slice(0, 24).reverse()

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Detalhes de ${codigo}`}>
        <div className="drawer-head">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>{tipo === 'fiis' ? 'Fundo imobiliário' : tipo === 'acoes' ? `Ação ${d?.tipo_acao || ''}` : tipo === 'criptos' ? `Cripto · #${d?.rank_mercado ?? '—'}` : 'ETF'} · {d?.categoria}{d?.segmento ? ` · ${d.segmento}` : ''}</div>
            <h1>{ticker}</h1>
            <div className="muted">{d?.razao_social}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!somenteLeitura && tipo !== 'criptos' && <button className="btn" onClick={atualizar} disabled={atualizando}>{atualizando ? 'Atualizando…' : 'Recoletar'}</button>}
            <button className="btn" onClick={onClose} aria-label="Fechar">✕</button>
          </div>
        </div>
        {erro && <div className="alert">{erro}</div>}
        {d?.alerta && <div className="alert">⚠ {d.alerta}</div>}
        {d && d.status !== 'ok' && <div className="alert">{tipo === 'criptos' ? 'Sem histórico no Yahoo Finance — mostrando só os dados do CoinGecko.' : 'Sem cotação no Yahoo Finance — o fundo pode não ser negociado em bolsa.'}</div>}

        {d?.status === 'ok' && (
          <>
            <LiveQuote ticker={ticker} />
            <div className="section"><PriceChart ticker={ticker} /></div>
          </>
        )}

        {d && GRUPOS[tipo].map(([nome, cols]) => (
          <div className="section" key={nome}>
            <h2>{nome}</h2>
            <div className="metric-grid">
              {cols.map((c) => (
                <div className="metric" key={c}>
                  <div className="label">{LABELS[c] || c}</div>
                  <div className={`value num ${colClass(c, d[c])}`}>{formatCol(c, d[c])}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {provs.length > 0 && (
          <div className="section card">
            <h2>Proventos por cota (R$) · últimos {provs.length}</h2>
            <BarChart data={provs} x="data" y="valor" />
          </div>
        )}
      </aside>
    </>
  )
}
