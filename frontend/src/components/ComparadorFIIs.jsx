import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt } from '../format.js'
import BuscaAtivo from './BuscaAtivo.jsx'
import { MultiLineChart } from './Charts.jsx'

const CORES = Array.from({ length: 6 }, (_, i) => `var(--series-${i + 1})`)
const PADRAO = ['HGLG11', 'KNRI11', 'XPLG11']
// [chave, rótulo, formato, maior é melhor? (null = neutro)]
const LINHAS = [
  ['segmento', 'Segmento', (v) => v || '—', null],
  ['preco', 'Preço', (v) => fmt.brl(v), null],
  ['pvp', 'P/VP', (v) => fmt.num(v, 2), false],
  ['dividend_yield', 'DY 12m', (v) => fmt.pct(v), true],
  ['vacancia', 'Vacância física', (v) => (v == null ? '—' : fmt.pct(v)), false],
  ['inadimplencia', 'Inadimplência', (v) => (v == null ? '—' : fmt.pct(v)), false],
  ['imoveis', 'Imóveis', (v) => (v == null ? '—' : fmt.int(v)), true],
  ['liquidez_media', 'Liquidez diária', (v) => fmt.big(v), true],
  ['cotistas', 'Cotistas', (v) => fmt.int(v), true],
  ['patrimonio_liquido', 'Patrimônio líquido', (v) => fmt.big(v), true],
  ['taxa_adm_anual', 'Taxa de administração', (v) => (v == null ? '—' : fmt.pct(v, 2)), false],
  ['alavancagem', 'Alavancagem', (v) => (v == null ? '—' : fmt.pct(v)), false],
  ['pct_imoveis', '% em imóveis', (v) => (v == null ? '—' : fmt.pct(v)), null],
  ['pct_papel', '% em papel (CRI/LCI)', (v) => (v == null ? '—' : fmt.pct(v)), null],
  ['rentab_patrimonial_12m', 'Rentab. patrimonial 12m', (v) => (v == null ? '—' : fmt.pct(v)), true],
]
const GRAFICOS = [
  ['pvp', 'P/VP mensal', (v) => fmt.num(v, 2), [{ y: 1, label: 'P/VP 1' }]],
  ['dy_12m', 'Dividend yield 12 meses (%)', (v) => fmt.pct(v), []],
  ['vp_cota', 'Valor patrimonial por cota (R$)', (v) => fmt.brl(v), []],
  ['cotistas', 'Cotistas', (v) => fmt.big(v), []],
]

// alinha as séries dos FIIs pelas mesmas datas (meses ou trimestres)
function series(fiis, campo, lista = 'historico', chaveData = 'mes') {
  const datas = [...new Set(fiis.flatMap((f) => (f[lista] || []).filter((h) => h[campo] != null).map((h) => h[chaveData])))].sort()
  return {
    datas: datas.map((d) => (d.length === 7 ? `${d}-01` : d)),
    series: fiis.map((f, i) => {
      const m = new Map((f[lista] || []).map((h) => [h[chaveData], h[campo]]))
      return { nome: f.ticker, valores: datas.map((d) => m.get(d) ?? NaN), cor: CORES[i] }
    }),
  }
}

export default function ComparadorFIIs({ onOpen }) {
  const [tickers, setTickers] = useState(PADRAO)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    if (!tickers.length) { setDados(null); return }
    let vivo = true
    setErro(null)
    api.compararFiis(tickers).then((d) => vivo && setDados(d)).catch((e) => vivo && setErro(e.message))
    return () => { vivo = false }
  }, [tickers.join(',')])

  const fiis = (dados?.fiis || []).filter((f) => !f.erro)
  const melhor = (k, maior) => {
    const v = fiis.map((f) => f[k]).filter((x) => typeof x === 'number')
    return v.length > 1 && maior != null ? (maior ? Math.max(...v) : Math.min(...v)) : undefined
  }
  const vac = series(fiis, 'vacancia', 'trimestral', 'data')
  const add = (t) => setTickers((s) => (s.includes(t) || s.length >= 6 ? s : [...s, t]))

  return (
    <>
      <h1>Comparar FIIs</h1>
      <p className="sub">Até 6 fundos lado a lado: indicadores de hoje e a história de P/VP, dividend yield, valor patrimonial, cotistas e vacância
        (informes mensal e trimestral da CVM + preços do Yahoo).</p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters" style={{ marginBottom: 8 }}><BuscaAtivo onAdd={add} label="Adicionar FII" /></div>
        <div className="chips" style={{ gap: 8 }}>
          {tickers.map((t, i) => (
            <span key={t} className="sel-chip"><i style={{ background: CORES[i] }} />{t}
              <button onClick={() => setTickers(tickers.filter((x) => x !== t))} aria-label={`Remover ${t}`}>✕</button>
            </span>
          ))}
        </div>
        {(dados?.fiis || []).filter((f) => f.erro).map((f) => <div key={f.ticker} className="muted" style={{ fontSize: 13 }}>{f.ticker}: {f.erro}</div>)}
      </div>
      {erro && <div className="alert">{erro}</div>}
      {!dados && !erro && tickers.length > 0 && <div className="empty">Carregando informes e preços…</div>}
      {fiis.length > 0 && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="table-wrap" style={{ maxHeight: 'none', border: 0 }}>
              <table>
                <thead><tr><th className="txt">Indicador</th>{fiis.map((f, i) => (
                  <th key={f.ticker}><span className="dot" style={{ background: CORES[i] }} />
                    <a href="#" onClick={(e) => { e.preventDefault(); onOpen?.('fiis', f.codigo) }}>{f.ticker}</a></th>
                ))}</tr></thead>
                <tbody>
                  {LINHAS.map(([k, l, f, maior]) => {
                    const b = melhor(k, maior)
                    return (
                      <tr key={k} style={{ cursor: 'default' }}>
                        <td className="txt">{l}</td>
                        {fiis.map((x) => <td key={x.ticker} className={`num ${b !== undefined && x[k] === b ? 'best' : ''}`}>{f(x[k])}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Em destaque o melhor de cada linha. Vacância física (ponderada pela área) e inadimplência (ponderada pela receita) do último informe
              trimestral{fiis[0]?.data_trimestral ? ` (${fmt.date(fiis[0].data_trimestral)})` : ''}; FIIs de papel não informam vacância.
            </p>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
            {GRAFICOS.map(([campo, titulo, fmtY, refs]) => {
              const s = series(fiis, campo)
              return (
                <div key={campo} className="card">
                  <h2 style={{ marginTop: 0 }}>{titulo}</h2>
                  {s.datas.length > 1 ? <MultiLineChart datas={s.datas} series={s.series} fmtY={fmtY} refs={refs} height={220} label={titulo} />
                    : <div className="empty">Sem histórico.</div>}
                </div>
              )
            })}
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Vacância física por trimestre (%)</h2>
              {vac.datas.length > 1 ? <MultiLineChart datas={vac.datas} series={vac.series} fmtY={(v) => fmt.pct(v)} height={220} label="Vacância" />
                : <div className="empty">Sem dados de vacância (comum em FIIs de papel).</div>}
            </div>
          </div>
        </>
      )}
    </>
  )
}
