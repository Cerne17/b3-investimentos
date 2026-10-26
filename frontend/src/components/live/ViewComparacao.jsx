import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../api.js'
import { fmt, signClass, signed } from '../../format.js'
import { calcular, compilar, EXEMPLOS, series } from '../../lib/formulas.js'
import BuscaAtivo from '../BuscaAtivo.jsx'
import { MultiLineChart } from '../Charts.jsx'
import { alinhar, cor, intervaloPadrao, SeletorPeriodo } from './comum.jsx'

const MAX = 8 // acima disso as cores deixam de ser distinguíveis

const MODOS = {
  base100: { nome: 'Base 100', desc: 'Todos começam em 100 no início do período', ref: 100 },
  pct: { nome: 'Variação %', desc: 'Retorno acumulado desde o início do período', ref: 0 },
  preco: { nome: 'Preço', desc: 'Cotação bruta (escalas diferentes podem achatar ativos baratos)' },
  formula: { nome: 'Fórmula', desc: 'Aplica a mesma fórmula a cada ativo (ex.: RSI, drawdown)' },
}

function estatisticas(close) {
  const v = Array.from(close).filter(Number.isFinite)
  if (v.length < 2) return {}
  const rets = v.slice(1).map((x, i) => x / v[i] - 1)
  const media = rets.reduce((a, b) => a + b, 0) / rets.length
  const dp = Math.sqrt(rets.reduce((a, r) => a + (r - media) ** 2, 0) / (rets.length - 1))
  let pico = v[0], dd = 0
  v.forEach((x) => { pico = Math.max(pico, x); dd = Math.min(dd, x / pico - 1) })
  return { ultimo: v[v.length - 1], retorno: (v[v.length - 1] / v[0] - 1) * 100, vol: dp * Math.sqrt(252) * 100, dd: dd * 100 }
}

export default function ViewComparacao({ view, onChange }) {
  const { tickers = [], periodo = '1y', modo = 'base100', expr = 'rsi(close, 14)' } = view
  const [hists, setHists] = useState({})
  const [erros, setErros] = useState({})
  const [cot, setCot] = useState({})
  const [rascunho, setRascunho] = useState(expr)
  const [erroExpr, setErroExpr] = useState(null)
  const set = (patch) => onChange({ ...view, ...patch })
  const intervalo = intervaloPadrao(periodo)

  useEffect(() => {
    setHists({}); setErros({})
    tickers.forEach((t) => api.historico(t, periodo, intervalo)
      .then((h) => setHists((s) => ({ ...s, [t]: h })))
      .catch((e) => setErros((s) => ({ ...s, [t]: e.message }))))
  }, [tickers.join(','), periodo])

  useEffect(() => {
    if (!tickers.length) return
    const load = () => api.cotacoes(tickers).then(setCot).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [tickers.join(',')])

  const prontos = tickers.filter((t) => hists[t])
  const intraday = !['1d', '1wk'].includes(intervalo)

  const { datas, linhas, erroCalc } = useMemo(() => {
    if (!prontos.length) return { datas: [], linhas: [] }
    const { datas, idx } = alinhar(prontos.map((t) => hists[t]), intraday ? (d) => d.slice(0, 16) : undefined)
    let erroCalc = null
    const linhas = prontos.map((t) => {
      const h = hists[t]
      const d = series(h)
      let v = d.close
      try {
        if (modo === 'formula') v = calcular(expr, d)
      } catch (e) { erroCalc = e.message; v = new Float64Array(h.length).fill(NaN) }
      if (modo === 'base100' || modo === 'pct') {
        const base = Array.from(v).find(Number.isFinite)
        v = v.map((x) => (modo === 'base100' ? (x / base) * 100 : (x / base - 1) * 100))
      }
      const grade = new Float64Array(datas.length).fill(NaN)
      h.forEach((p, i) => { grade[idx.get(intraday ? p.data.slice(0, 16) : p.data.slice(0, 10))] = v[i] })
      return { t, valores: grade, stats: estatisticas(d.close) }
    })
    return { datas, linhas, erroCalc }
  }, [hists, prontos.join(','), modo, expr])

  const add = (t) => { if (!tickers.includes(t) && tickers.length < MAX) set({ tickers: [...tickers, t] }) }
  const fmtY = modo === 'pct' ? (v) => signed(v) : modo === 'preco' ? (v) => fmt.num(v) : (v) => fmt.num(v)
  const aplicar = () => { try { compilar(rascunho); setErroExpr(null); set({ expr: rascunho }) } catch (e) { setErroExpr(e.message) } }

  return (
    <>
      <div className="card">
        <div className="filters">
          <BuscaAtivo onAdd={add} label={`Adicionar ativo (até ${MAX})`} width={260} />
          <div className="field">Período<SeletorPeriodo periodo={periodo} onChange={(p) => set({ periodo: p })} /></div>
          <label className="field">Comparar por
            <select value={modo} onChange={(e) => set({ modo: e.target.value })}>
              {Object.entries(MODOS).map(([k, m]) => <option key={k} value={k}>{m.nome}</option>)}
            </select>
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '-4px 0 10px' }}>{MODOS[modo].desc}</p>
        {modo === 'formula' && (
          <div style={{ marginBottom: 10 }}>
            <textarea className="formula" rows={2} value={rascunho} onChange={(e) => { setRascunho(e.target.value); setErroExpr(null) }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <button className="btn primary" onClick={aplicar}>Aplicar</button>
              {[['RSI 14', 'rsi(close, 14)'], ['Drawdown', '(close / cummax(close) - 1) * 100'], ['Volatilidade 21d', 'std(pct(close, 1), 21) * sqrt(252)'], ...EXEMPLOS.slice(1, 3)].map(([n, e]) => (
                <button key={n} className="chip" onClick={() => { setRascunho(e); setErroExpr(null); set({ expr: e }) }}>{n}</button>
              ))}
              {(erroExpr || erroCalc) && <span className="neg" style={{ fontSize: 13 }}>{erroExpr || erroCalc}</span>}
            </div>
          </div>
        )}
        <div className="chips" style={{ gap: 8, marginBottom: 0 }}>
          {tickers.map((t, i) => {
            const q = cot[t]
            return (
              <span key={t} className="sel-chip"><i style={{ background: cor(i) }} />{t}
                {q && !q.erro && <span className={`num ${signClass(q.variacao_pct)}`} style={{ fontWeight: 500 }}>{fmt.num(q.preco)} {signed(q.variacao_pct)}</span>}
                {erros[t] && <span className="neg" style={{ fontWeight: 400 }}>sem dados</span>}
                <button onClick={() => set({ tickers: tickers.filter((x) => x !== t) })} aria-label={`Remover ${t}`}>✕</button>
              </span>
            )
          })}
          {tickers.length < 2 && <span className="muted">Adicione pelo menos dois ativos para comparar.</span>}
        </div>
      </div>

      {linhas.length > 0 && (
        <>
          <div className="card section">
            <h2>{modo === 'formula' ? <>Fórmula · <code style={{ fontWeight: 400 }}>{expr}</code></> : MODOS[modo].nome}</h2>
            <MultiLineChart datas={datas} height={340} fmtY={fmtY} label="Comparação"
              refs={MODOS[modo].ref != null ? [{ y: MODOS[modo].ref }] : []}
              series={linhas.map((l) => ({ nome: l.t, cor: cor(tickers.indexOf(l.t)), valores: l.valores }))} />
          </div>
          <div className="card section">
            <h2>Resumo do período</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th className="txt">Ativo</th><th>Último</th><th>Retorno</th><th>Volatilidade a.a.</th><th>Drawdown máx.</th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.t} style={{ cursor: 'default' }}>
                      <td className="txt"><span className="dot" style={{ background: cor(tickers.indexOf(l.t)) }} />{l.t}</td>
                      <td className="num">{fmt.num(l.stats.ultimo)}</td>
                      <td className={`num ${signClass(l.stats.retorno)}`}>{signed(l.stats.retorno)}</td>
                      <td className="num">{intraday ? '—' : fmt.pct(l.stats.vol)}</td>
                      <td className="num">{signed(l.stats.dd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
