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

function OndeAportar({ c, tickers, aporte, qtdAtuais }) {
  const [r, setR] = useState(null)
  const [erro, setErro] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const calcular = () => {
    setCarregando(true); setErro(null)
    api.aporte({ tickers, pesos: tickers.map((t) => c.pesos[t]), quantidades: tickers.map((t) => qtdAtuais[t] || 0), aporte: Number(aporte) })
      .then(setR).catch((e) => setErro(e.message)).finally(() => setCarregando(false))
  }
  useEffect(() => { setR(null) }, [aporte, JSON.stringify(qtdAtuais)])
  if (!(Number(aporte) > 0)) return null
  return (
    <div style={{ marginTop: 12 }}>
      {!r && <button className="btn" onClick={calcular} disabled={carregando}>{carregando ? 'Calculando…' : `Onde aportar ${fmt.brl(Number(aporte))}`}</button>}
      {erro && <div className="alert">{erro}</div>}
      {r && (
        <>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Aporte de {fmt.brl(r.aporte)} · só compras</div>
          <table>
            <thead><tr><th className="txt">Ativo</th><th title="Peso hoje">Hoje</th><th>Alvo</th><th>Comprar</th><th>Valor</th><th title="Peso depois da compra">Depois</th></tr></thead>
            <tbody>
              {r.ativos.map((x) => (
                <tr key={x.ticker} style={{ cursor: 'default', opacity: x.valor_compra > 0 ? 1 : 0.6 }}>
                  <td className="txt">{x.ticker}</td>
                  <td className="num">{fmt.pct(x.peso_atual, 1)}</td>
                  <td className="num">{fmt.pct(x.peso_alvo, 1)}</td>
                  <td className="num"><b>{x.fracionario ? fmt.num(x.comprar, x.comprar < 1 ? 6 : 2) : x.comprar}</b></td>
                  <td className="num">{fmt.brl(x.valor_compra)}</td>
                  <td className="num">{fmt.pct(x.peso_depois, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Usa {fmt.brl(r.usado)}{r.sobra > 0.01 ? ` (sobram ${fmt.brl(r.sobra)})` : ''} · fora do alvo: {fmt.pct(r.fora_do_alvo_antes, 1)} → {fmt.pct(r.fora_do_alvo_depois, 1)} da carteira.
            {!Object.keys(qtdAtuais).length && ' Sem posições atuais: importe do Home Broker para considerar o que você já tem.'}
          </div>
        </>
      )}
    </div>
  )
}

function CarteiraCard({ c, idx, tickers, melhor, valor, onSimular, onBroker, aporte, qtdAtuais }) {
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
      {a.renda_mensal != null && (
        <div className="port-total" style={{ marginTop: 4 }}>
          <span title="Proventos pagos nos últimos 12 meses por cota × cotas compradas, ÷ 12">Renda estimada <b className="num">{fmt.brl(a.renda_mensal)}/mês</b></span>
          <span className="muted"><span className="num">{fmt.brl(a.renda_anual)}</span>/ano</span>
        </div>
      )}
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
      <OndeAportar c={c} tickers={tickers} aporte={aporte} qtdAtuais={qtdAtuais || {}} />
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
  const [dyMin, setDyMin] = useState('')
  const [aporte, setAporte] = useState('')
  const [ir, setIr] = useState(false)
  const [qtdAtuais, setQtdAtuais] = useState({}) // posições trazidas do Home Broker, para "onde aportar"
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
    setTickers(lista); setRes(null); setErro(null); setImportada(nome); setQtdAtuais({})
    // peso máximo precisa permitir somar 100% com esse número de ativos
    setPmax((m) => Math.max(m, Math.ceil(100 / lista.length)))
  }

  const rodar = async () => {
    setErro(null); setRodando(true)
    try {
      setRes(await api.otimizar({
        tickers, valor: Number(valor), peso_min: pmin / 100, peso_max: pmax / 100, periodo,
        taxa_livre_risco: rf / 100, indicadores: inds, filosofia: filosofia || null, dy_min: dyMin === '' ? null : Number(dyMin), ir,
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
    valor: res?.parametros.valor, aporte, qtdAtuais,
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
          <ImportarBroker onInicio={importarInicio}
            onValores={({ total, tickers: ts, quantidades }) => { setValor(Math.round(total)); setQtdAtuais(Object.fromEntries(ts.map((t, i) => [t, quantidades[i]]))) }} />
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
          <label className="field" title="Restrição: toda carteira otimizada precisa ter pelo menos este dividend yield (proventos dos últimos 12 meses). Vazio = sem restrição.">
            DY mínimo (% a.a.)<input type="number" min="0" max="50" step="0.5" placeholder="sem mínimo" value={dyMin} onChange={(e) => setDyMin(e.target.value)} />
          </label>
          <label className="field" title="Dinheiro novo deste mês: cada carteira otimizada mostra quantas cotas comprar para chegar perto do alvo, sem vender nada">
            Aporte do mês (R$)<input type="number" min="0" step="100" placeholder="opcional" value={aporte} onChange={(e) => setAporte(e.target.value)} />
          </label>
          <label className="field" title="Otimiza com retornos depois do imposto: ganho de capital 15% (FIIs 20%), proventos de ETF 15%, renda fixa de referência x 0,85. Isenções mensais de vendas não entram.">
            <span><input type="checkbox" checked={ir} onChange={(e) => setIr(e.target.checked)} /> Líquido de IR</span>
            <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>ganho 15% · FII 20%</span>
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
