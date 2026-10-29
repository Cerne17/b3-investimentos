import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { fmt, signClass, signed } from '../format.js'
import BuscaAtivo from './BuscaAtivo.jsx'
import ImportarBroker from './ImportarBroker.jsx'
import { ehCripto } from '../lib/ativos.js'
import { FanChart, Histogram } from './Charts.jsx'

const CORES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const cor = (i) => CORES[i] || 'var(--text-muted)'
const MODOS = [['carteira', 'Carteira'], ['meta', 'Meta financeira'], ['ativo', 'Ativo']]
const METODOS = [['bootstrap', 'Bootstrap do histórico'], ['t', 't de Student (caudas gordas)'], ['normal', 'Normal (GBM)']]
const HORIZONTES = [[1, '1 mês'], [3, '3 meses'], [6, '6 meses'], [12, '1 ano'], [24, '2 anos'], [60, '5 anos']]

// eixo compacto (R$ 1,2 mi) e valor completo no tooltip
const brlEixo = (v, eixo) => (eixo ? fmt.big(v) : fmt.brl(v))

function Kpi({ label, value, hint, className = '' }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value num ${className}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Pesos({ itens, setItens }) {
  const total = itens.reduce((a, b) => a + (Number(b.peso) || 0), 0)
  return (
    <>
      <div className="chips" style={{ gap: 8 }}>
        {itens.map((it, i) => (
          <span key={it.ticker} className="sel-chip"><i style={{ background: cor(i) }} />{it.ticker}
            <input type="number" min="0" max="100" step="1" value={it.peso} aria-label={`Peso de ${it.ticker} (%)`}
              style={{ width: 58, marginLeft: 6 }} onChange={(e) => setItens(itens.map((x) => (x.ticker === it.ticker ? { ...x, peso: e.target.value } : x)))} />%
            <button onClick={() => setItens(itens.filter((x) => x.ticker !== it.ticker))} aria-label={`Remover ${it.ticker}`}>✕</button>
          </span>
        ))}
        {!itens.length && <span className="muted">Adicione ativos (ações, FIIs, ETFs, cripto como BTC-BRL).</span>}
      </div>
      {itens.length > 0 && (
        <div className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
          Soma dos pesos: <b className={Math.abs(total - 100) > 0.5 ? 'neg' : ''}>{fmt.num(total, 1)}%</b>
          {Math.abs(total - 100) > 0.5 && ' (será normalizada para 100%)'}{' '}
          <button className="btn" style={{ padding: '2px 8px', fontSize: 12 }}
            onClick={() => setItens(itens.map((x) => ({ ...x, peso: +(100 / itens.length).toFixed(2) })))}>Pesos iguais</button>
        </div>
      )}
    </>
  )
}

function RendaProventos({ r }) {
  const p = r.parametros, rd = r.renda
  const sacar = p.proventos === 'sacar'
  const metaRenda = r.meta?.tipo === 'renda' ? r.meta.valor : null
  const topo = Math.max(...rd.bandas.p95)
  const metaVisivel = metaRenda && metaRenda <= topo * 2 // meta muito acima achataria o leque
  if (!(p.dy_hist_anual > 0)) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Renda em proventos</h2>
        <div className="muted">Nenhum ativo da carteira pagou proventos no histórico usado: a renda simulada é zero.</div>
      </div>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Renda em proventos · {sacar ? 'sacados todo mês' : 'reinvestidos'}</h2>
      <div className="grid kpis compacto" style={{ marginBottom: 8 }}>
        <Kpi label="Renda mensal no 1º ano (mediana)" value={fmt.brl(rd.primeiro_ano.p50)} hint={`DY histórico da carteira ${fmt.pct(p.dy_hist_anual)} a.a.`} />
        <Kpi label={`Renda mensal no ano ${Math.ceil(p.anos)} (mediana)`} value={fmt.brl(rd.final.p50)} hint={`p10 ${fmt.brl(rd.final.p10)} · p90 ${fmt.brl(rd.final.p90)}`} />
        <Kpi label={sacar ? 'Total sacado em proventos' : 'Total reinvestido em proventos'} value={fmt.brl(rd.recebido.p50)} hint="mediana da soma no horizonte" />
        <Kpi label="Yield on cost no fim" value={rd.yield_on_cost != null ? fmt.pct(rd.yield_on_cost) : '—'} hint="renda anual ÷ total aportado" />
      </div>
      <FanChart datas={r.datas} bandas={rd.bandas} fmtY={brlEixo} label="Leque de percentis da renda mensal" cor="var(--series-3)"
        refs={metaVisivel ? [{ y: metaRenda, label: `Meta ${fmt.brl(metaRenda)}/mês`, cor: 'var(--series-3)' }] : []} height={260} />
      {metaRenda && !metaVisivel && <div className="muted" style={{ fontSize: 13 }}>A meta de {fmt.brl(metaRenda)}/mês fica bem acima até dos cenários otimistas (p95 {fmt.brl(topo)}/mês) e foi omitida do gráfico.</div>}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Renda mensal = média dos proventos dos últimos 12 meses (suaviza pagamentos semestrais de ações).
        {sacar ? ' Sacando, o patrimônio cresce só pela variação de preço; as comparações com o aportado e com a renda fixa somam o patrimônio e o que foi sacado.'
          : ' Reinvestindo, o provento compra mais cotas e a renda cresce junto com o patrimônio.'} Sem imposto de renda.
      </p>
    </div>
  )
}

function ResultadoCarteira({ r, meta }) {
  const [verCaminhos, setVerCaminhos] = useState(false)
  const p = r.parametros, f = r.final
  const real = p.valores_reais
  const sacar = p.proventos === 'sacar'
  const metaPatrimonio = r.meta?.tipo === 'renda' ? null : meta
  const linhas = [
    { nome: 'Total aportado', valores: r.investido, cor: 'var(--text-muted)', tracejado: true },
    { nome: `Renda fixa ${fmt.pct(p.taxa_livre_risco * 100, 1)} a.a.`, valores: r.renda_fixa, cor: 'var(--series-2)', tracejado: true },
    ...(verCaminhos ? r.caminhos.map((c, i) => ({ nome: `Cenário ${i + 1}`, valores: c, cor: 'var(--text-muted)', fino: true, opacidade: 0.45 })) : []),
  ]
  const refsHist = [
    { x: f.investido, label: 'Aportado', cor: 'var(--text-muted)' },
    { x: f.p50, label: 'Mediana', cor: 'var(--text-primary)' },
    ...(metaPatrimonio ? [{ x: metaPatrimonio, label: 'Meta', cor: 'var(--series-3)' }] : []),
  ]
  return (
    <>
      <div className="grid kpis compacto">
        <Kpi label={`Patrimônio mediano em ${p.anos} ano${p.anos > 1 ? 's' : ''}`} value={fmt.brl(f.p50)}
          hint={sacar ? `Aportado: ${fmt.brl(f.investido)} · + ${fmt.brl(r.renda.recebido.p50)} sacados` : `Aportado: ${fmt.brl(f.investido)}`} />
        {f.liquido && <Kpi label="Depois do IR (resgate no fim)" value={fmt.brl(f.liquido.p50)} hint={`IR mediano ${fmt.brl(f.imposto.p50)} · alíquota média ${fmt.pct(p.ir.aliquota_ganho_media, 1)}`} />}
        <Kpi label="Faixa de 90% dos cenários" value={<span style={{ fontSize: 18 }}>{fmt.big(f.p5)} – {fmt.big(f.p95)}</span>} hint="percentis 5 e 95" />
        <Kpi label={sacar ? 'Chance de patrimônio + sacado ficar abaixo do aportado' : 'Chance de terminar abaixo do aportado'} value={fmt.pct(f.prob_perda, 1)} className={f.prob_perda > 10 ? 'neg' : ''}
          hint={f.perda_media_5_piores > 0 ? `Nos 5% piores: perda média de ${fmt.brl(f.perda_media_5_piores)}` : 'Mesmo os 5% piores cenários terminam no lucro'} />
        <Kpi label="Chance de superar a renda fixa" value={fmt.pct(f.prob_superar_renda_fixa, 1)} hint={`Renda fixa no fim: ${fmt.brl(f.renda_fixa)}${p.ir ? ' (líquida de IR)' : ''}`} />
        <Kpi label={`Retorno anual${real ? ' real' : ''} (mediana)`} value={signed(f.cagr.p50)} className={signClass(f.cagr.p50)} hint={`p5 ${signed(f.cagr.p5)} · p95 ${signed(f.cagr.p95)}`} />
        <Kpi label="Maior queda no caminho (mediana)" value={signed(f.max_drawdown.p50)} className="neg" hint={`1 em 20 cenários: ${signed(f.max_drawdown.p95)} ou pior`} />
      </div>

      {r.meta && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{r.meta.tipo === 'renda' ? `Meta de renda de ${fmt.brl(r.meta.valor)}/mês` : `Meta de ${fmt.brl(r.meta.valor)}`}{real ? ' (em reais de hoje)' : ''}</h2>
          <div className="grid kpis compacto" style={{ marginBottom: 8 }}>
            <Kpi label={`Chance de atingir em ${p.anos} anos`} value={fmt.pct(r.meta.prob, 1)} className={r.meta.prob >= 75 ? 'pos' : r.meta.prob < 50 ? 'neg' : ''} />
            <Kpi label="Tempo mediano até a meta" value={r.meta.meses_mediana != null ? `${Math.floor(r.meta.meses_mediana / 12)}a ${r.meta.meses_mediana % 12}m` : '—'}
              hint={r.meta.meses_mediana == null ? 'Menos da metade dos cenários chega lá'
                : r.meta.tipo === 'renda' ? 'primeira vez que a renda média de 12 meses toca a meta' : 'primeira vez que o patrimônio toca a meta'} />
            {Object.entries(r.meta.aporte_necessario).map(([prob, v]) => (
              <Kpi key={prob} label={`Aporte mensal para ${prob}% de chance`} value={v == null ? 'Inalcançável' : fmt.brl(v)}
                hint={v == null ? 'a carteira quase não paga proventos' : v <= p.aporte_mensal ? 'seu aporte já basta' : `+${fmt.brl(v - p.aporte_mensal)} por mês`} />
            ))}
          </div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Chance de já ter atingido a meta, ano a ano</div>
          <div className="meta-anos">
            {r.meta.prob_por_ano.map((a) => (
              <div key={a.ano} title={`Ano ${a.ano}: ${fmt.pct(a.prob, 1)}`}>
                <div className="barra"><div style={{ height: `${Math.max(2, a.prob)}%` }} /></div>
                <span className="num">{fmt.num(a.prob, 0)}%</span>
                <span className="muted">{a.ano}a</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Patrimônio projetado{real ? ` · em reais de hoje (inflação ${fmt.pct(p.inflacao * 100, 1)} a.a.)` : ''}</h2>
          <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={verCaminhos} onChange={(e) => setVerCaminhos(e.target.checked)} />Mostrar 12 cenários sorteados
          </label>
        </div>
        <FanChart datas={r.datas} bandas={r.bandas} linhas={linhas} fmtY={brlEixo} label="Leque de percentis do patrimônio"
          refs={metaPatrimonio ? [{ y: metaPatrimonio, label: `Meta ${fmt.big(metaPatrimonio)}`, cor: 'var(--series-3)' }] : []} height={340} />
      </div>

      <div style={{ marginTop: 16 }}><RendaProventos r={r} /></div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', marginTop: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Distribuição do patrimônio final</h2>
          <Histogram {...r.histograma} refs={refsHist} fmtX={brlEixo} label="Histograma do patrimônio final" />
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Percentis no fim</h2>
          <table>
            <tbody>
              {['p95', 'p90', 'p75', 'p50', 'p25', 'p10', 'p5'].map((k) => (
                <tr key={k} style={{ cursor: 'default' }}>
                  <td className="txt">{k === 'p50' ? 'Mediana' : `${k === 'p95' || k === 'p90' || k === 'p75' ? 'Otimista' : 'Pessimista'} (p${k.slice(1)})`}</td>
                  <td className="num"><b>{fmt.brl(f[k])}</b></td>
                  <td className={`num ${signClass(f.cagr[k])}`}>{signed(f.cagr[k])} a.a.</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            {fmt.int(p.simulacoes)} cenários · {METODOS.find(([k]) => k === p.metodo)?.[1]} · calibrado em {fmt.date(p.inicio)}–{fmt.date(p.fim)}
            ({fmt.int(p.dias_historico)} dias): retorno histórico {signed(p.retorno_hist_anual)} a.a., volatilidade {fmt.pct(p.vol_hist_anual)}.
            Carteira rebalanceada para os pesos {Object.entries(p.pesos).map(([t, w]) => `${t} ${fmt.pct(w * 100, 0)}`).join(', ')}; aporte no fim de cada mês; proventos {sacar ? 'sacados' : 'reinvestidos'}.
          </p>
        </div>
      </div>
    </>
  )
}

function ResultadoAtivo({ r }) {
  const p = r.parametros, f = r.final
  const hist = r.historico
  // histórico real à esquerda, leque à direita (o último preço é o ponto de partida dos dois)
  const datas = [...hist.datas, ...r.datas.slice(1)]
  const pad = (arr) => [...Array(hist.datas.length - 1).fill(NaN), ...arr]
  const bandas = Object.fromEntries(Object.entries(r.bandas).map(([k, v]) => [k, pad(v)]))
  const linhaHist = [...hist.precos.slice(0, -1), p.preco_atual, ...Array(r.datas.length - 1).fill(NaN)]
  const fp = (v, eixo) => (eixo && Math.abs(v) >= 1e5 ? fmt.big(v) : fmt.preco(v))
  return (
    <>
      <div className="grid kpis compacto">
        <Kpi label="Preço atual" value={fmt.preco(p.preco_atual)} hint={p.ticker} />
        <Kpi label="Preço mediano no horizonte" value={fmt.preco(f.p50)} hint={`retorno mediano ${signed(f.retorno_mediano)}`} />
        <Kpi label="Faixa de 90% dos cenários" value={<span style={{ fontSize: 18 }}>{fmt.preco(f.p5)} – {fmt.preco(f.p95)}</span>} />
        <Kpi label="Chance de terminar em alta" value={fmt.pct(f.prob_alta, 1)} />
        <Kpi label={`Chance de tocar ${signed(r.alvos.alta, 0)}`} value={fmt.pct(f.prob_alvo_alta, 1)} className="pos" />
        <Kpi label={`Chance de tocar ${signed(r.alvos.queda, 0)}`} value={fmt.pct(f.prob_alvo_queda, 1)} className="neg" />
        <Kpi label="VaR 95% no horizonte" value={fmt.pct(-f.var_95_pct, 1)} className="neg" hint={`média dos 5% piores: ${fmt.pct(-f.cvar_95_pct, 1)}`} />
        <Kpi label="Maior queda no caminho (mediana)" value={signed(f.max_drawdown_p50)} className="neg" />
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cone de preço · {p.ticker}</h2>
        <FanChart datas={datas} bandas={bandas} fmtY={fp} label={`Cone de preço de ${p.ticker}`} height={340}
          linhas={[{ nome: 'Histórico', valores: linhaHist, cor: 'var(--text-primary)' }]}
          refs={[{ y: p.preco_atual * (1 + r.alvos.alta / 100), label: signed(r.alvos.alta, 0), cor: 'var(--series-3)' },
            { y: p.preco_atual * (1 + r.alvos.queda / 100), label: signed(r.alvos.queda, 0), cor: 'var(--series-8)' }]} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', marginTop: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Distribuição do retorno no horizonte</h2>
          <Histogram {...r.histograma} fmtX={(v) => signed(v, 0)} label="Histograma do retorno"
            refs={[{ x: 0, label: '0%', cor: 'var(--text-muted)' }, { x: f.retorno_mediano, label: 'Mediana', cor: 'var(--text-primary)' }]} />
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Como foi calculado</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            {fmt.int(p.simulacoes)} caminhos de {fmt.int(p.dias)} {p.dias_ano === 365 ? 'dias corridos (cripto negocia todo dia)' : 'pregões'} ·
            {' '}{METODOS.find(([k]) => k === p.metodo)?.[1]} · calibrado em {fmt.date(p.inicio)}–{fmt.date(p.fim)}: retorno histórico
            {' '}{signed(p.retorno_hist_anual)} a.a., volatilidade {fmt.pct(p.vol_hist_anual)}. Retornos de preço (sem proventos).
          </p>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            “Tocar” um alvo considera o caminho inteiro, não só o preço final — por isso a chance de tocar {signed(r.alvos.queda, 0)} costuma
            ser bem maior que a de terminar abaixo dele.
          </p>
        </div>
      </div>
    </>
  )
}

export default function MonteCarlo({ preset }) {
  const [modo, setModo] = useState('carteira')
  const [itens, setItens] = useState([
    { ticker: 'MXRF11', peso: 35 }, { ticker: 'GARE11', peso: 3 }, { ticker: 'GOLD11', peso: 34 }, { ticker: 'AUVP11', peso: 28 },
  ])
  const [valor, setValor] = useState(400)
  const [aporte, setAporte] = useState(400)
  const [anos, setAnos] = useState(10)
  const [meta, setMeta] = useState(100000)
  const [metaTipo, setMetaTipo] = useState('patrimonio')
  const [metaRenda, setMetaRenda] = useState(3000)
  const [proventos, setProventos] = useState('reinvestir')
  const [ir, setIr] = useState(false)
  const [real, setReal] = useState(true)
  const [inflacao, setInflacao] = useState(4.5)
  const [metodo, setMetodo] = useState('bootstrap')
  const [periodo, setPeriodo] = useState('5y')
  const [sims, setSims] = useState(5000)
  const [ativo, setAtivo] = useState('BTC-BRL')
  const [horizonte, setHorizonte] = useState(12)
  const [alta, setAlta] = useState(20)
  const [queda, setQueda] = useState(-20)
  const [res, setRes] = useState(null)
  const [erro, setErro] = useState(null)
  const [rodando, setRodando] = useState(false)
  const [origem, setOrigem] = useState(null)

  useEffect(() => {
    if (!preset) return
    setModo('carteira'); setRes(null)
    setItens(preset.tickers.map((t, i) => ({ ticker: t, peso: +((preset.pesos?.[i] ?? 1 / preset.tickers.length) * 100).toFixed(2) })).filter((x) => x.peso > 0))
    if (preset.valor_inicial) setValor(Math.round(preset.valor_inicial))
    setOrigem(preset.nome || null)
  }, [preset?.t])

  // carteira do Home Broker: pesos pelo valor de mercado de cada posição e valor inicial = patrimônio atual
  const importarInicio = ({ nome, tickers }) => {
    setItens(tickers.map((t) => ({ ticker: t, peso: +(100 / tickers.length).toFixed(2) }))); setOrigem(nome); setRes(null); setErro(null)
  }
  const importarValores = ({ tickers, valores, total }) => {
    setItens(tickers.map((t, i) => ({ ticker: t, peso: +(valores[i] / total * 100).toFixed(2) })))
    setValor(Math.round(total))
  }
  const add = (t) => setItens((s) => (s.some((x) => x.ticker === t) ? s : [...s, { ticker: t, peso: s.length ? 0 : 100 }]))

  const rodar = async () => {
    setErro(null); setRodando(true)
    try {
      if (modo === 'ativo') {
        const dias = Math.round(horizonte * (ehCripto(ativo) ? 30.4 : 21))
        setRes({ modo, r: await api.mcAtivo({ ticker: ativo, dias, metodo, periodo, simulacoes: Math.min(sims, 5000), alvo_alta: Number(alta), alvo_queda: Number(queda) }) })
      } else {
        const r = await api.mcCarteira({
          tickers: itens.map((x) => x.ticker), pesos: itens.map((x) => Number(x.peso) || 0), valor_inicial: Number(valor),
          aporte_mensal: Number(aporte), anos: Number(anos), simulacoes: Number(sims), metodo, periodo,
          meta: modo === 'meta' ? Number(metaTipo === 'renda' ? metaRenda : meta) : null, meta_tipo: metaTipo, proventos, ir,
          inflacao: real ? Number(inflacao) / 100 : 0,
        })
        setRes({ modo, r })
      }
    } catch (e) { setErro(e.message); setRes(null) } finally { setRodando(false) }
  }

  const podeRodar = modo === 'ativo' ? !!ativo : itens.length > 0 && itens.some((x) => Number(x.peso) > 0)
  const mostrado = useMemo(() => (res && (res.modo === modo || (res.modo !== 'ativo' && modo !== 'ativo')) ? res : null), [res, modo])

  return (
    <>
      <h1>Monte Carlo</h1>
      <p className="sub">Milhares de futuros possíveis sorteados a partir do comportamento real dos ativos: quanto a carteira pode valer,
        a chance de bater uma meta e o leque de preços de um ativo. Não é previsão — é a distribuição do que já aconteceu, reembaralhada.</p>

      <div className="seg" style={{ marginBottom: 12 }}>
        {MODOS.map(([k, l]) => <button key={k} className={modo === k ? 'on' : ''} onClick={() => setModo(k)}>{l}</button>)}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {modo === 'ativo' ? (
          <>
            <div className="filters" style={{ marginBottom: 8 }}>
              <BuscaAtivo onAdd={setAtivo} label="Ativo" width={260} />
              <div className="field">Selecionado<span className="sel-chip" style={{ marginTop: 4 }}><i style={{ background: cor(0) }} />{ativo}</span></div>
            </div>
            <div className="filters">
              <label className="field">Horizonte
                <select value={horizonte} onChange={(e) => setHorizonte(Number(e.target.value))}>
                  {HORIZONTES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="field">Alvo de alta (%)<input type="number" value={alta} step="5" onChange={(e) => setAlta(e.target.value)} /></label>
              <label className="field">Alvo de queda (%)<input type="number" value={queda} step="5" max="0" onChange={(e) => setQueda(e.target.value)} /></label>
            </div>
          </>
        ) : (
          <>
            {origem && <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Carteira trazida: <b>{origem}</b></div>}
            <div className="filters" style={{ marginBottom: 8 }}>
              <BuscaAtivo onAdd={add} label="Adicionar ativo" />
              <ImportarBroker onInicio={importarInicio} onValores={importarValores} />
            </div>
            <Pesos itens={itens} setItens={setItens} />
            <div className="filters">
              <label className="field">Valor inicial (R$)<input type="number" min="0" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
              <label className="field">Aporte mensal (R$)<input type="number" min="0" value={aporte} onChange={(e) => setAporte(e.target.value)} /></label>
              <label className="field">Anos<input type="number" min="1" max="40" value={anos} onChange={(e) => setAnos(e.target.value)} /></label>
              <label className="field" title="Proventos líquidos (FII e dividendos de ações isentos, ETF 15%) e IR sobre o ganho num resgate total no fim (15%; FIIs 20%). Isenções mensais e IR de rebalanceamento não entram.">
                <span><input type="checkbox" checked={ir} onChange={(e) => setIr(e.target.checked)} /> Descontar IR</span>
                <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>resgate no fim</span>
              </label>
              <label className="field">Proventos
                <select value={proventos} onChange={(e) => setProventos(e.target.value)}>
                  <option value="reinvestir">Reinvestir</option>
                  <option value="sacar">Sacar (viram renda)</option>
                </select>
              </label>
              {modo === 'meta' && (
                <label className="field">Tipo de meta
                  <select value={metaTipo} onChange={(e) => setMetaTipo(e.target.value)}>
                    <option value="patrimonio">Patrimônio</option>
                    <option value="renda">Renda mensal</option>
                  </select>
                </label>
              )}
              {modo === 'meta' && (metaTipo === 'renda'
                ? <label className="field">Renda desejada (R$/mês)<input type="number" min="1" step="500" value={metaRenda} onChange={(e) => setMetaRenda(e.target.value)} /></label>
                : <label className="field">Meta (R$)<input type="number" min="1" step="10000" value={meta} onChange={(e) => setMeta(e.target.value)} /></label>)}
              <label className="field">
                <span><input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} /> Descontar inflação (% a.a.)</span>
                <input type="number" step="0.5" min="0" value={inflacao} disabled={!real} onChange={(e) => setInflacao(e.target.value)} />
              </label>
            </div>
          </>
        )}
        <div className="filters">
          <label className="field">Método
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">Histórico para calibrar
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {[['2y', '2 anos'], ['5y', '5 anos'], ['10y', '10 anos'], ['max', 'Máximo']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">Simulações
            <select value={sims} onChange={(e) => setSims(Number(e.target.value))}>
              {[1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{fmt.int(n)}</option>)}
            </select>
          </label>
          <button className="btn primary" onClick={rodar} disabled={rodando || !podeRodar}>{rodando ? 'Simulando…' : 'Simular'}</button>
        </div>
        {modo !== 'ativo' && real && (
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Com inflação, tudo aparece em reais de hoje e o aporte é corrigido todo mês (mantém o poder de compra).
          </p>
        )}
      </div>

      {erro && <div className="alert">{erro}</div>}
      {rodando && !mostrado && <div className="empty">Baixando histórico e sorteando cenários…</div>}
      {mostrado && (mostrado.modo === 'ativo'
        ? <ResultadoAtivo r={mostrado.r} />
        : <ResultadoCarteira r={mostrado.r} meta={mostrado.r.meta?.valor} />)}

      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Simulações usam o passado como molde e não capturam mudanças de regime, eventos sem precedente, impostos nem custos.
        Uso educacional — não é recomendação de investimento.
      </p>
    </>
  )
}
