import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { carregar, limpar, novaCarteira, salvar } from '../lib/broker.js'
import { fmt, signClass, signed } from '../format.js'
import BuscaAtivo from './BuscaAtivo.jsx'
import { MultiLineChart } from './Charts.jsx'

const CORES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const cor = (i) => CORES[i] || 'var(--text-muted)'
const CLASSES = { ACAO: 'Ações', FII: 'FIIs', ETF: 'ETFs', CRIPTO: 'Cripto' }
const TIPO_ROTA = { ACAO: 'acoes', FII: 'fiis', ETF: 'etfs', CRIPTO: 'criptos' }
const PERIODOS = [
  { k: '1d', l: 'Hoje', intervalo: '5m', minutos: 5 },
  { k: '5d', l: '5 dias', intervalo: '30m', minutos: 30 },
  { k: '1mo', l: '1 mês', intervalo: '1d' },
  { k: '6mo', l: '6 meses', intervalo: '1d' },
  { k: '1y', l: '1 ano', intervalo: '1d' },
]
const EXEMPLO = [
  { ticker: 'MXRF11', quantidade: 15, preco_medio: 9.1 },
  { ticker: 'GOLD11', quantidade: 6, preco_medio: 21.5 },
  { ticker: 'IVVB11', quantidade: 2, preco_medio: 380 },
  { ticker: 'BTC-BRL', quantidade: 0.0012, preco_medio: 450000 },
]
const qtdFmt = (q) => (Number.isInteger(q) ? fmt.int(q) : fmt.num(q, q < 1 ? 6 : 4))
const hora = (s, longo) => {
  const d = new Date(s)
  return longo ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function Kpi({ label, value, sub, className = '' }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value num ${className}`}>{value}</div>
      {sub && <div className="hint">{sub}</div>}
    </div>
  )
}

// valor da carteira ATUAL ao longo do período (quantidades de hoje x preços de cada momento)
function useEvolucao(posicoes, periodo, tick) {
  const [serie, setSerie] = useState(null)
  const [erro, setErro] = useState(null)
  const chave = posicoes.map((p) => `${p.ticker}:${p.quantidade}`).join(',')
  useEffect(() => {
    if (!posicoes.length) { setSerie(null); return }
    let vivo = true
    const per = PERIODOS.find((p) => p.k === periodo)
    Promise.all(posicoes.map((p) => api.historico(p.ticker, per.k, per.intervalo).catch(() => [])))
      .then((hs) => {
        if (!vivo) return
        const bucket = per.minutos ? (s) => Math.floor(Date.parse(s) / (per.minutos * 60000)) * per.minutos * 60000 : (s) => s.slice(0, 10)
        const chaves = [...new Set(hs.flatMap((h) => h.map((x) => bucket(x.data))))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        if (!chaves.length) { setSerie(null); setErro('Sem histórico para o período.'); return }
        const pos = new Map(chaves.map((c, i) => [c, i]))
        const valores = new Float64Array(chaves.length)
        hs.forEach((h, j) => {
          const col = new Array(chaves.length).fill(NaN)
          h.forEach((x) => { if (Number.isFinite(x.fechamento)) col[pos.get(bucket(x.data))] = x.fechamento })
          // preenche para frente (último preço conhecido) e, antes do primeiro dado, com o primeiro preço
          let ult = col.find(Number.isFinite)
          for (let i = 0; i < col.length; i++) { if (Number.isFinite(col[i])) ult = col[i]; valores[i] += (ult || 0) * posicoes[j].quantidade }
        })
        setSerie({ datas: chaves.map((c) => (per.minutos ? new Date(c).toISOString() : c)), valores, intradia: !!per.minutos })
        setErro(null)
      })
      .catch((e) => vivo && setErro(e.message))
    return () => { vivo = false }
  }, [chave, periodo, periodo === '1d' ? tick : 0])
  return [serie, erro]
}

export default function HomeBroker({ onOpen, onSimular }) {
  const [estado, setEstado] = useState(carregar)
  const [cot, setCot] = useState({})
  const [info, setInfo] = useState({})
  const [atualizado, setAtualizado] = useState(null)
  const [auto, setAuto] = useState(true)
  const [tick, setTick] = useState(0)
  const [periodo, setPeriodo] = useState('1d')
  const [novo, setNovo] = useState({ ticker: '', quantidade: '', preco_medio: '' })
  const [ordem, setOrdem] = useState({ col: 'valor', dir: -1 })
  const arquivo = useRef(null)

  const carteira = estado.carteiras.find((c) => c.id === estado.ativa) || estado.carteiras[0]
  const posicoes = carteira?.posicoes || []
  const tickers = posicoes.map((p) => p.ticker)

  const atualizarEstado = (fn) => setEstado((e) => salvar(fn(e)))
  const setPosicoes = (fn) => atualizarEstado((e) => ({
    ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, posicoes: limpar(fn(c.posicoes)) } : c)),
  }))

  // cotações ao vivo (a API guarda cache de 30 s)
  useEffect(() => {
    if (!tickers.length) return
    let vivo = true
    const load = () => api.cotacoes(tickers).then((d) => { if (vivo) { setCot(d); setAtualizado(new Date()); setTick((t) => t + 1) } }).catch(() => {})
    load()
    const id = auto ? setInterval(load, 30000) : null
    return () => { vivo = false; if (id) clearInterval(id) }
  }, [tickers.join(','), auto])

  // dados da base (classe, proventos 12m, DY) para renda estimada e alocação por classe
  useEffect(() => {
    if (!tickers.length) return
    api.comparar(tickers).then((lista) => {
      const m = {}
      for (const d of lista) m[(d.ticker || d.codigo).toUpperCase()] = d
      setInfo(m)
    }).catch(() => {})
  }, [tickers.join(',')])

  const [serie, erroSerie] = useEvolucao(posicoes, periodo, tick)

  const linhas = useMemo(() => posicoes.map((p, i) => {
    const q = cot[p.ticker] || {}
    const d = info[p.ticker] || info[p.ticker.replace(/-BRL$/, '')] || {}
    const preco = Number.isFinite(q.preco) ? q.preco : null
    const valor = preco != null ? preco * p.quantidade : null
    const custo = p.preco_medio * p.quantidade
    const ant = q.fechamento_anterior
    const varDia = preco != null && ant ? (preco - ant) * p.quantidade : null
    const prov12 = d.tipo === 'CRIPTO' ? 0 : d.proventos_12m
    return {
      ...p, i, preco, valor, custo, nome: q.nome || d.nome_pregao || d.razao_social, erro: q.erro,
      var_pct: q.variacao_pct, var_dia: varDia, resultado: valor != null && custo ? valor - custo : null,
      resultado_pct: valor != null && custo ? (valor / custo - 1) * 100 : null,
      tipo: d.tipo || (/-(BRL|USD)$/.test(p.ticker) ? 'CRIPTO' : null), codigo: d.codigo,
      dy: d.tipo === 'CRIPTO' ? null : d.dividend_yield, renda_mes: prov12 ? (prov12 * p.quantidade) / 12 : null,
    }
  }), [posicoes, cot, info])

  const tot = useMemo(() => {
    const soma = (k) => linhas.reduce((a, l) => a + (Number.isFinite(l[k]) ? l[k] : 0), 0)
    const valor = soma('valor'), custo = soma('custo'), varDia = soma('var_dia'), renda = soma('renda_mes')
    // resultado só sobre posições já cotadas (evita "-100%" enquanto as cotações chegam)
    const custoCotado = linhas.reduce((a, l) => a + (Number.isFinite(l.valor) ? l.custo : 0), 0)
    const ontem = valor - varDia
    return { valor, custo, varDia, varDiaPct: ontem ? (varDia / ontem) * 100 : null, resultado: valor - custoCotado,
      resultadoPct: custoCotado ? (valor / custoCotado - 1) * 100 : null, renda, dy: valor ? (renda * 12 / valor) * 100 : null,
      cotado: linhas.some((l) => Number.isFinite(l.valor)) }
  }, [linhas])

  const classes = useMemo(() => {
    const m = {}
    linhas.forEach((l) => { const c = CLASSES[l.tipo] || 'Outros'; m[c] = (m[c] || 0) + (l.valor || 0) })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [linhas])

  const ordenadas = useMemo(() => [...linhas].map((l) => ({ ...l, peso: l.valor })).sort((a, b) => {
    const va = a[ordem.col], vb = b[ordem.col]
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * ordem.dir
    return ((Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity)) * ordem.dir
  }), [linhas, ordem])

  // ---- ações de carteira ----
  const criar = (nome, pos = []) => setEstado(novaCarteira(nome, pos))
  const renomear = () => {
    const nome = window.prompt('Nome da carteira:', carteira.nome)
    if (nome) atualizarEstado((e) => ({ ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, nome } : c)) }))
  }
  const excluir = () => {
    if (!window.confirm(`Excluir a carteira "${carteira.nome}" deste navegador? Isso não pode ser desfeito.`)) return
    atualizarEstado((e) => {
      const resto = e.carteiras.filter((c) => c.id !== carteira.id)
      return { ativa: resto[0]?.id || null, carteiras: resto }
    })
  }
  const exportar = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(carteira, null, 2)], { type: 'application/json' }))
    a.download = `${carteira.nome.replace(/[^\w-]+/g, '_')}.json`
    a.click()
  }
  const importar = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    f.text().then((txt) => {
      const d = JSON.parse(txt)
      const pos = Array.isArray(d) ? d : d.posicoes
      if (!Array.isArray(pos)) throw new Error('formato')
      criar(d.nome || f.name.replace(/\.json$/i, ''), pos)
    }).catch(() => window.alert('Arquivo inválido: esperado um JSON com { nome, posicoes: [{ ticker, quantidade, preco_medio }] }.'))
    e.target.value = ''
  }
  const escolherNovo = (t) => {
    setNovo((n) => ({ ...n, ticker: t }))
    api.cotacao(t).then((q) => setNovo((n) => (n.ticker === t && !n.preco_medio ? { ...n, preco_medio: +q.preco.toPrecision(6) } : n))).catch(() => {})
  }
  const adicionar = (e) => {
    e.preventDefault()
    if (!novo.ticker || !(Number(novo.quantidade) > 0)) return
    setPosicoes((ps) => [...ps, { ticker: novo.ticker, quantidade: Number(novo.quantidade), preco_medio: Number(novo.preco_medio) || 0 }])
    setNovo({ ticker: '', quantidade: '', preco_medio: '' })
  }
  const editar = (ticker, campo, v) => setPosicoes((ps) => ps.map((p) => (p.ticker === ticker ? { ...p, [campo]: Number(v) } : p)))
  const remover = (ticker) => setPosicoes((ps) => ps.filter((p) => p.ticker !== ticker))
  const th = (col, label, cls = '') => (
    <th className={`${cls} ${ordem.col === col ? 'sorted' : ''}`} onClick={() => setOrdem((o) => ({ col, dir: o.col === col ? -o.dir : -1 }))}>
      {label}{ordem.col === col ? (ordem.dir < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  )

  if (!carteira) {
    return (
      <>
        <h1>Home Broker</h1>
        <p className="sub">Acompanhe uma carteira em tempo real: patrimônio, variação do dia, resultado por ativo e renda estimada. As carteiras ficam salvas só neste navegador.</p>
        <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn primary" onClick={() => criar('Minha carteira')}>Criar carteira vazia</button>
          <button className="btn" onClick={() => criar('Carteira de exemplo', EXEMPLO)}>Começar com um exemplo</button>
          <button className="btn" onClick={() => arquivo.current?.click()}>Importar JSON</button>
          <input ref={arquivo} type="file" accept="application/json,.json" hidden onChange={importar} />
          <span className="muted" style={{ fontSize: 13 }}>Também dá para trazer uma carteira otimizada pela aba Carteira.</span>
        </div>
      </>
    )
  }

  const per = PERIODOS.find((p) => p.k === periodo)
  const inicio = serie ? serie.valores[0] : null
  const fim = serie ? serie.valores[serie.valores.length - 1] : null

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Home Broker</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Carteira em tempo real · cotações do Yahoo Finance a cada 30 s · salva só neste navegador.</p>
        </div>
        <div className="hb-status">
          <span className={`pulso ${auto ? 'on' : ''}`} />
          {atualizado ? `Atualizado às ${atualizado.toLocaleTimeString('pt-BR')}` : 'Buscando cotações…'}
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />auto</label>
        </div>
      </div>

      <div className="filters" style={{ marginTop: 12 }}>
        <label className="field">Carteira
          <select value={carteira.id} onChange={(e) => atualizarEstado((s) => ({ ...s, ativa: e.target.value }))}>
            {estado.carteiras.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => criar(`Carteira ${estado.carteiras.length + 1}`)}>Nova</button>
        <button className="btn" onClick={renomear}>Renomear</button>
        <button className="btn" onClick={exportar}>Exportar</button>
        <button className="btn" onClick={() => arquivo.current?.click()}>Importar</button>
        <input ref={arquivo} type="file" accept="application/json,.json" hidden onChange={importar} />
        {onSimular && posicoes.length > 0 && tot.valor > 0 && (
          <button className="btn" onClick={() => onSimular({ tickers, pesos: linhas.map((l) => (l.valor || 0) / tot.valor), valor_inicial: tot.valor, nome: carteira.nome })}>
            Simular no Monte Carlo
          </button>
        )}
        <button className="btn" onClick={excluir} style={{ color: 'var(--critical)' }}>Excluir</button>
      </div>

      {!tot.cotado && posicoes.length > 0 ? <div className="empty">Buscando cotações…</div> : (
      <div className="grid kpis compacto">
        <Kpi label="Patrimônio" value={fmt.brl(tot.valor)} sub={`${posicoes.length} ativo${posicoes.length === 1 ? '' : 's'}`} />
        <Kpi label="Variação do dia" value={`${tot.varDia >= 0 ? '+' : ''}${fmt.brl(tot.varDia)}`} className={signClass(tot.varDia)} sub={signed(tot.varDiaPct)} />
        <Kpi label="Resultado total" value={`${tot.resultado >= 0 ? '+' : ''}${fmt.brl(tot.resultado)}`} className={signClass(tot.resultado)}
          sub={`${signed(tot.resultadoPct)} sobre ${fmt.brl(tot.custo)} investidos`} />
        <Kpi label="Renda passiva estimada" value={`${fmt.brl(tot.renda)}/mês`} sub={`DY da carteira ${fmt.pct(tot.dy)} · proventos dos últimos 12 meses`} />
      </div>
      )}

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Valor da carteira</h2>
            <div className="seg">
              {PERIODOS.map((p) => <button key={p.k} className={periodo === p.k ? 'on' : ''} onClick={() => setPeriodo(p.k)}>{p.l}</button>)}
            </div>
          </div>
          {serie ? (
            <>
              <div className="muted" style={{ fontSize: 13, margin: '6px 0' }}>
                {per.l}: <b className={`num ${signClass(fim - inicio)}`}>{fim - inicio >= 0 ? '+' : ''}{fmt.brl(fim - inicio)} ({signed((fim / inicio - 1) * 100)})</b>
                {' '}· quantidades de hoje aplicadas aos preços de cada momento
              </div>
              <MultiLineChart datas={serie.datas} series={[{ nome: 'Carteira', valores: serie.valores, cor: 'var(--series-1)' }]}
                fmtY={(v) => fmt.brl(v)} fmtX={serie.intradia ? hora : fmt.date} label="Valor da carteira no período"
                refs={tot.custo ? [{ y: tot.custo, label: 'Custo' }] : []} height={240} />
            </>
          ) : <div className="empty">{erroSerie || (posicoes.length ? 'Carregando histórico…' : 'Adicione ativos para ver a evolução.')}</div>}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Alocação</h2>
          <div className="stack" aria-hidden="true">
            {linhas.filter((l) => l.valor > 0).map((l) => <div key={l.ticker} style={{ width: `${(l.valor / tot.valor) * 100}%`, background: cor(l.i) }} title={`${l.ticker} ${fmt.pct((l.valor / tot.valor) * 100, 1)}`} />)}
          </div>
          <div className="hb-aloc">
            {linhas.filter((l) => l.valor > 0).sort((a, b) => b.valor - a.valor).map((l) => (
              <div key={l.ticker}><span><i className="dot" style={{ background: cor(l.i) }} />{l.ticker}</span><b className="num">{fmt.pct((l.valor / tot.valor) * 100, 1)}</b></div>
            ))}
          </div>
          <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Por classe</div>
          <div className="hb-aloc">
            {classes.map(([c, v]) => (
              <div key={c}><span>{c}</span><b className="num">{fmt.pct(tot.valor ? (v / tot.valor) * 100 : 0, 1)} · {fmt.big(v)}</b></div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <form className="filters" onSubmit={adicionar} style={{ marginBottom: 8 }}>
          <BuscaAtivo onAdd={escolherNovo} label="Adicionar posição" width={240} />
          {novo.ticker && <div className="field">Ativo<span className="sel-chip" style={{ marginTop: 4 }}>{novo.ticker}</span></div>}
          <label className="field">Quantidade<input type="number" step="any" min="0" value={novo.quantidade} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} /></label>
          <label className="field">Preço médio (R$)<input type="number" step="any" min="0" value={novo.preco_medio} onChange={(e) => setNovo({ ...novo, preco_medio: e.target.value })} /></label>
          <button className="btn primary" disabled={!novo.ticker || !(Number(novo.quantidade) > 0)}>Adicionar</button>
        </form>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                {th('ticker', 'Ativo', 'txt')}{th('quantidade', 'Qtd.')}{th('preco_medio', 'Preço médio')}{th('preco', 'Preço')}
                {th('var_pct', 'Dia %')}{th('var_dia', 'Dia R$')}{th('valor', 'Valor')}{th('peso', 'Peso')}
                {th('resultado', 'Resultado')}{th('resultado_pct', 'Result. %')}{th('dy', 'DY 12m')}{th('renda_mes', 'Renda/mês')}
                <th aria-label="Remover" />
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l) => (
                <tr key={l.ticker} onClick={() => l.codigo && TIPO_ROTA[l.tipo] && onOpen(TIPO_ROTA[l.tipo], l.codigo)} style={{ cursor: l.codigo ? 'pointer' : 'default' }}>
                  <td className="txt">
                    <span className="dot" style={{ background: cor(l.i) }} /><span className="tk">{l.ticker}</span>
                    {l.tipo && <span className="badge" style={{ marginLeft: 6 }}>{CLASSES[l.tipo]}</span>}
                    <span className="nm">{l.erro || l.nome}</span>
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="hb-edit" type="number" step="any" min="0" defaultValue={l.quantidade} aria-label={`Quantidade de ${l.ticker}`}
                      key={`q${l.quantidade}`} onBlur={(e) => Number(e.target.value) !== l.quantidade && editar(l.ticker, 'quantidade', e.target.value)} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="hb-edit" type="number" step="any" min="0" defaultValue={l.preco_medio} aria-label={`Preço médio de ${l.ticker}`}
                      key={`p${l.preco_medio}`} onBlur={(e) => Number(e.target.value) !== l.preco_medio && editar(l.ticker, 'preco_medio', e.target.value)} />
                  </td>
                  <td className="num"><b>{l.preco != null ? fmt.preco(l.preco) : '…'}</b></td>
                  <td className={`num ${signClass(l.var_pct)}`}>{signed(l.var_pct)}</td>
                  <td className={`num ${signClass(l.var_dia)}`}>{l.var_dia != null ? fmt.brl(l.var_dia) : '—'}</td>
                  <td className="num">{fmt.brl(l.valor)}</td>
                  <td className="num">{l.valor != null && tot.valor ? fmt.pct((l.valor / tot.valor) * 100, 1) : '—'}</td>
                  <td className={`num ${signClass(l.resultado)}`}>{l.resultado != null ? fmt.brl(l.resultado) : '—'}</td>
                  <td className={`num ${signClass(l.resultado_pct)}`}>{signed(l.resultado_pct)}</td>
                  <td className="num">{fmt.pct(l.dy)}</td>
                  <td className="num">{l.renda_mes ? fmt.brl(l.renda_mes) : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="chip" style={{ padding: '0 6px' }} aria-label={`Remover ${l.ticker}`} onClick={() => remover(l.ticker)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!posicoes.length && <div className="empty">Carteira vazia — adicione a primeira posição acima.</div>}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Quantidades fracionárias valem para cripto (ex.: 0,0012 BTC-BRL). Renda estimada = proventos pagos nos últimos 12 meses ÷ 12 (dados da base, sem cripto).
          Somente acompanhamento: não envia ordens.
        </p>
      </div>
    </>
  )
}

