import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, signClass, signed } from '../format.js'
import { FrontierChart } from './Charts.jsx'
import BuscaAtivo from './BuscaAtivo.jsx'
import { novaCarteira } from '../lib/broker.js'
import ImportarBroker from './ImportarBroker.jsx'

const CORES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const cor = (i) => CORES[i] || 'var(--text-muted)' // acima de 8 ativos a cor deixa de identificar; o rótulo sempre aparece

// métricas da tabela comparativa: [chave, rótulo, formato, maior é melhor?]
const LINHAS = [
  ['retorno_anual', 'Retorno anual', (v) => signed(v), true],
  ['cagr', 'Retorno composto (CAGR)', (v) => signed(v), true],
  ['volatilidade', 'Volatilidade', (v) => fmt.pct(v), false],
  ['sharpe', 'Sharpe', (v) => fmt.num(v, 2), true],
  ['sortino', 'Sortino', (v) => fmt.num(v, 2), true],
  ['calmar', 'Calmar', (v) => fmt.num(v, 2), true],
  ['omega', 'Omega', (v) => fmt.num(v, 2), true],
  ['max_drawdown', 'Drawdown máx.', (v) => signed(v), true],
  ['cvar_95_diario', 'CVaR 95% diário', (v) => fmt.pct(v), false],
  ['dividend_yield', 'Dividend yield 12m', (v) => fmt.pct(v), true],
  ['renda_risco', 'Renda por risco', (v) => fmt.num(v, 2), true],
]

function CarteiraCard({ c, idx, tickers, melhor, valor, onSimular, onBroker }) {
  const a = c.alocacao
  return (
    <div className="card port-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h3>{idx != null ? `${idx + 1}. ` : ''}{c.nome}</h3>
          <p className="desc">{c.descricao}</p>
        </div>
        {melhor && <span className="badge" title="Melhor no indicador que otimiza">★</span>}
      </div>
      <div className="stack" aria-hidden="true">
        {tickers.map((t, i) => (c.pesos[t] > 0 ? <div key={t} style={{ width: `${c.pesos[t] * 100}%`, background: cor(i) }} title={`${t} ${fmt.pct(c.pesos[t] * 100, 1)}`} /> : null))}
      </div>
      <div className="port-table">
        <table>
          <thead><tr><th className="txt">Ativo</th><th title="Peso ótimo da otimização">Alvo</th><th>Cotas</th><th>Valor</th><th title="Peso real após arredondar para cotas inteiras">Real</th></tr></thead>
          <tbody>
            {tickers.map((t, i) => (
              <tr key={t} style={{ cursor: 'default' }}>
                <td className="txt"><span className="dot" style={{ background: cor(i) }} />{t}</td>
                <td className="num">{fmt.pct(c.pesos[t] * 100, 1)}</td>
                <td className="num">{a.fracionario?.[i] ? fmt.num(a.cotas[i], a.cotas[i] < 1 ? 6 : 4) : a.cotas[i]}</td>
                <td className="num">{fmt.brl(a.valores[i])}</td>
                <td className="num">{fmt.pct(a.pct_do_valor[i] * 100, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="port-total">
        <span>Investido <b className="num">{fmt.brl(a.investido)}</b></span>
        <span className="muted">Sobra <span className="num">{fmt.brl(a.sobra)}</span></span>
      </div>
      <div className="kv">
        {[['Retorno', signed(c.metricas.retorno_anual)], ['Volatilidade', fmt.pct(c.metricas.volatilidade)], ['Sharpe', fmt.num(c.metricas.sharpe)],
          ['Sortino', fmt.num(c.metricas.sortino)], ['Drawdown', signed(c.metricas.max_drawdown)], ['DY', fmt.pct(c.metricas.dividend_yield)]].map(([l, v]) => (
          <div key={l}><div className="label">{l}</div><div className="value num">{v}</div></div>
        ))}
      </div>
      {(onSimular || onBroker) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {onSimular && <button className="btn" onClick={() => onSimular({ tickers, pesos: tickers.map((t) => c.pesos[t]), valor_inicial: Number(valor), nome: c.nome })}>Simular no Monte Carlo</button>}
          {onBroker && <button className="btn" onClick={() => onBroker(c)} title="Cria uma carteira no Home Broker com estas quantidades e o preço atual como preço médio">Acompanhar no Home Broker</button>}
        </div>
      )}
    </div>
  )
}

export default function Carteira({ onSimular, onBroker }) {
  const [opcoes, setOpcoes] = useState(null)
  const [tickers, setTickers] = useState(['MXRF11', 'GARE11', 'GOLD11', 'AUVP11'])
  const [valor, setValor] = useState(400)
  const [pmin, setPmin] = useState(0)
  const [pmax, setPmax] = useState(35)
  const [periodo, setPeriodo] = useState('2y')
  const [rf, setRf] = useState(14)
  const [filosofia, setFilosofia] = useState('value_conservador')
  const [inds, setInds] = useState(['sharpe', 'sortino', 'calmar', 'renda_risco'])
  const [res, setRes] = useState(null)
  const [erro, setErro] = useState(null)
  const [rodando, setRodando] = useState(false)

  useEffect(() => { api.carteiraOpcoes().then(setOpcoes).catch((e) => setErro(e.message)) }, [])

  const escolherFilosofia = (k) => {
    setFilosofia(k)
    const f = opcoes?.filosofias[k]
    if (f) { setInds(f.indicadores); setPmax(Math.round(f.peso_max * 100)) }
  }
  const toggle = (k) => { setFilosofia(''); setInds((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k])) }
  const add = (t) => setTickers((s) => (s.includes(t) ? s : [...s, t]))

  const [importada, setImportada] = useState(null)
  const importarInicio = ({ nome, tickers: lista }) => {
    setTickers(lista); setRes(null); setErro(null); setImportada(nome)
    // peso máximo precisa permitir somar 100% com esse número de ativos
    setPmax((m) => Math.max(m, Math.ceil(100 / lista.length)))
  }

  const rodar = async () => {
    setErro(null); setRodando(true)
    try {
      setRes(await api.otimizar({
        tickers, valor: Number(valor), peso_min: pmin / 100, peso_max: pmax / 100, periodo,
        taxa_livre_risco: rf / 100, indicadores: inds, filosofia: filosofia || null,
      }))
    } catch (e) { setErro(e.message); setRes(null) } finally { setRodando(false) }
  }

  const todas = res ? [...res.carteiras, res.pesos_iguais] : []
  const melhorDe = (k, maior) => {
    const vals = todas.map((c) => c.metricas[k]).filter((v) => v != null)
    return vals.length ? (maior ? Math.max(...vals) : Math.min(...vals)) : null
  }
  const tks = res?.parametros.tickers || tickers
  const acoes = {
    valor: res?.parametros.valor,
    onSimular,
    onBroker: onBroker && ((c) => {
      const a = c.alocacao
      novaCarteira(c.nome, tks.map((t, i) => ({ ticker: t, quantidade: a.cotas[i], preco_medio: a.precos[i] })).filter((p) => p.quantidade > 0))
      onBroker()
    }),
  }

  return (
    <>
      <h1>Markowitz</h1>
      <p className="sub">Escolha os ativos, o perfil e os indicadores. A otimização usa retornos diários totais (preço + proventos reinvestidos) e converte os pesos em cotas inteiras ao preço atual.</p>

      <div className="card">
        <div className="filters" style={{ marginBottom: 8 }}>
          <BuscaAtivo onAdd={add} />
          <ImportarBroker onInicio={importarInicio} onValores={({ total }) => setValor(Math.round(total))} />
        </div>
        {importada && <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>Ativos e valor de mercado trazidos de <b>{importada}</b>. A otimização ignora os pesos atuais e propõe novos.</p>}
        <div className="chips" style={{ gap: 8 }}>
          {tickers.map((t, i) => (
            <span key={t} className="sel-chip"><i style={{ background: cor(i) }} />{t}
              <button onClick={() => setTickers(tickers.filter((x) => x !== t))} aria-label={`Remover ${t}`}>✕</button>
            </span>
          ))}
          {!tickers.length && <span className="muted">Nenhum ativo selecionado.</span>}
        </div>

        <div className="filters">
          <label className="field">Valor (R$)<input type="number" value={valor} min="1" onChange={(e) => setValor(e.target.value)} /></label>
          <label className="field">Peso mín. (%)<input type="number" value={pmin} min="0" max="100" onChange={(e) => setPmin(Number(e.target.value))} /></label>
          <label className="field">Peso máx. (%)<input type="number" value={pmax} min="1" max="100" onChange={(e) => setPmax(Number(e.target.value))} /></label>
          <label className="field">Histórico
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              <option value="1y">1 ano</option><option value="2y">2 anos</option><option value="5y">5 anos</option><option value="10y">10 anos</option>
            </select>
          </label>
          <label className="field">Taxa livre de risco (% a.a.)<input type="number" value={rf} step="0.25" onChange={(e) => setRf(Number(e.target.value))} /></label>
          <label className="field">Filosofia / perfil
            <select value={filosofia} onChange={(e) => escolherFilosofia(e.target.value)}>
              <option value="">Personalizado</option>
              {opcoes && Object.entries(opcoes.filosofias).map(([k, f]) => <option key={k} value={k}>{f.nome}</option>)}
            </select>
          </label>
        </div>
        {filosofia && opcoes && <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>{opcoes.filosofias[filosofia].descricao}</p>}
        <div className="field" style={{ marginBottom: 12 }}>Indicadores a otimizar
          <div className="checks">
            {opcoes && Object.entries(opcoes.indicadores).map(([k, v]) => (
              <button key={k} className={`chip ${inds.includes(k) ? 'on' : ''}`} title={v.descricao} onClick={() => toggle(k)}>{v.nome}</button>
            ))}
          </div>
        </div>
        <button className="btn primary" onClick={rodar} disabled={rodando || tickers.length < 2 || !inds.length}>
          {rodando ? 'Otimizando…' : 'Simular carteiras'}
        </button>
        {tickers.length * pmax < 100 && <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>Com {tickers.length} ativos o peso máximo precisa ser ≥ {fmt.num(100 / Math.max(tickers.length, 1), 1)}%.</span>}
      </div>

      {erro && <div className="alert section">{erro}</div>}

      {res && (
        <>
          <p className="muted section" style={{ fontSize: 13 }}>
            Janela comum: {fmt.date(res.parametros.inicio)} a {fmt.date(res.parametros.fim)} ({res.parametros.pregoes} pregões) ·
            taxa livre de risco {fmt.pct(res.parametros.taxa_livre_risco * 100)} a.a. · resultados históricos, não garantem retorno futuro.
          </p>

          <div className="card section">
            <h2>Comparativo</h2>
            <div className="table-wrap" style={{ maxHeight: 'none' }}>
              <table>
                <thead>
                  <tr><th className="txt">Métrica</th>{todas.map((c, i) => <th key={c.chave}>{c.chave === 'iguais' ? 'Pesos iguais' : `${i + 1}. ${c.nome}`}</th>)}</tr>
                </thead>
                <tbody>
                  {LINHAS.map(([k, l, f, maior]) => {
                    const best = melhorDe(k, maior)
                    return (
                      <tr key={k} style={{ cursor: 'default' }}>
                        <td className="txt">{l}</td>
                        {todas.map((c) => <td key={c.chave} className={`num ${c.metricas[k] === best ? 'best' : ''}`}>{f(c.metricas[k])}</td>)}
                      </tr>
                    )
                  })}
                  {tks.map((t, i) => (
                    <tr key={t} style={{ cursor: 'default' }}>
                      <td className="txt"><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cor(i), marginRight: 6 }} />Peso {t}</td>
                      {todas.map((c) => <td key={c.chave} className="num">{fmt.pct(c.pesos[t] * 100, 1)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Em destaque o melhor valor de cada linha.</p>
          </div>

          <div className="port-grid section">
            {res.carteiras.map((c, i) => <CarteiraCard key={c.chave} c={c} idx={i} tickers={tks} {...acoes} />)}
            <CarteiraCard c={res.pesos_iguais} tickers={tks} {...acoes} />
          </div>

          <div className="grid two section">
            <div className="card">
              <h2>Fronteira eficiente</h2>
              <FrontierChart fronteira={res.fronteira} ativos={res.ativos} carteiras={todas} cores={tks.map((_, i) => cor(i))} />
            </div>
            <div className="card">
              <h2>Ativos individuais</h2>
              <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th className="txt">Ativo</th><th>Preço</th><th>Ret.</th><th>Volat.</th><th>DD</th><th>DY</th><th>P/VP</th><th>P/L</th></tr></thead>
                <tbody>
                  {res.ativos.map((a, i) => (
                    <tr key={a.ticker} style={{ cursor: 'default' }}>
                      <td className="txt"><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cor(i), marginRight: 6 }} />{a.ticker}
                        <div className="muted" style={{ fontSize: 11 }}>{a.fundamentos?.categoria || '—'}</div></td>
                      <td className="num">{fmt.brl(a.preco)}</td>
                      <td className={`num ${signClass(a.retorno_anual)}`}>{signed(a.retorno_anual)}</td>
                      <td className="num">{fmt.pct(a.volatilidade)}</td>
                      <td className="num">{signed(a.max_drawdown)}</td>
                      <td className="num">{fmt.pct(a.dividend_yield)}</td>
                      <td className="num">{fmt.num(a.fundamentos?.pvp)}</td>
                      <td className="num">{fmt.num(a.fundamentos?.pl, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <h2 style={{ marginTop: 20 }}>Correlação</h2>
              <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th className="txt" />{res.correlacao.tickers.map((t) => <th key={t}>{t}</th>)}</tr></thead>
                <tbody>
                  {res.correlacao.matriz.map((row, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td className="txt">{res.correlacao.tickers[i]}</td>
                      {row.map((v, j) => (
                        <td key={j} className="num" style={{ background: i === j ? 'var(--surface-2)' : `color-mix(in srgb, ${v >= 0 ? 'var(--series-1)' : 'var(--series-2)'} ${Math.round(Math.abs(v) * 45)}%, transparent)` }}>
                          {fmt.num(v, 2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>Azul = correlação positiva, laranja = negativa. Correlações baixas ou negativas reduzem o risco da carteira.</p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
