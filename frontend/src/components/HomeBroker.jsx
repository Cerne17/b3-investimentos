import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { carregar, novaCarteira, salvar } from '../lib/broker.js'
import { carteiraDoLink, limparLink, linkDaCarteira } from '../lib/compartilhar.js'
import { fmt, signClass, signed } from '../format.js'
import Desempenho, { ImpostoVendas, useDesempenho } from './Desempenho.jsx'
import Declaracao from './Declaracao.jsx'
import Operacoes from './Operacoes.jsx'
import Alertas from './Alertas.jsx'
import Rebalanceamento from './Rebalanceamento.jsx'
import { BarChart, MultiLineChart } from './Charts.jsx'
import { TITULOS } from './live/comum.jsx'
import { ehCripto, ehRendaFixa } from '../lib/ativos.js'

const CORES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const cor = (i) => CORES[i] || 'var(--text-muted)'
const CLASSES = { ACAO: 'Ações', FII: 'FIIs', ETF: 'ETFs', CRIPTO: 'Cripto', RF: 'Renda fixa' }
const TIPO_ROTA = { ACAO: 'acoes', FII: 'fiis', ETF: 'etfs', CRIPTO: 'criptos' }
const PERIODOS = [
  { k: '1d', l: 'Hoje', intervalo: '5m', minutos: 5 },
  { k: '24h', l: '1 dia', intervalo: '5m', minutos: 5 },
  { k: '7d', l: '1 semana', intervalo: '30m', minutos: 30 },
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

// últimos 12 meses, do mais antigo ao atual, no formato AAAA-MM
const ultimos12 = () => {
  const d = new Date()
  return Array.from({ length: 12 }, (_, i) => new Date(d.getFullYear(), d.getMonth() - 11 + i, 1))
    .map((m) => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
}

// cotas que a carteira tinha no fim do dia anterior à data ex (quem compra na data ex não recebe)
const cotasNaDataEx = (transacoes, ticker, dataEx) => Math.max(0, transacoes
  .filter((t) => t.ticker === ticker && t.data < dataEx)
  .reduce((a, t) => a + (t.tipo === 'venda' ? -t.quantidade : t.quantidade), 0))

function Agenda({ agenda }) {
  if (!agenda) return <div className="empty">Estimando os próximos pagamentos…</div>
  const proximos = agenda.meses.flatMap((m) => m.itens).filter((i) => i.data_ex >= new Date().toISOString().slice(0, 10)).slice(0, 6)
  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Próximos 12 meses · estimativa pela regularidade</div>
      <BarChart data={agenda.total_12m > 0 ? agenda.meses.map((m) => ({ mes: `${m.mes}-01`, valor: m.total })) : []} x="mes" y="valor" format={(v) => fmt.num(v, 2)} />
      <div className="muted" style={{ fontSize: 13 }}>Estimado em 12 meses: <b className="num">{fmt.brl(agenda.total_12m)}</b> · média {fmt.brl(agenda.total_12m / 12)}/mês</div>
      {proximos.length > 0 && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          {proximos.map((i) => <div key={i.ticker + i.data_ex}><span className="num">{fmt.date(i.data_ex)}</span> · {i.ticker} · <b className="num">{fmt.brl(i.valor)}</b></div>)}
        </div>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }} title={agenda.ativos.map((a) => `${a.ticker}: ${a.padrao}`).join(' · ')}>
        {agenda.ativos.filter((a) => a.pagamentos).map((a) => `${a.ticker} ${a.padrao}`).join(' · ')}
      </div>
    </>
  )
}

function Proventos({ linhas, provs, tot, metaRenda, setMetaRenda, transacoes, recebidos, agenda }) {
  const meses = ultimos12()
  // recebido de verdade: cada provento x as cotas que havia na data ex (compras e vendas ao longo do ano contam).
  // Com o desempenho carregado usa o cálculo do servidor (já na base atual, com desdobramentos e cupons do Tesouro).
  const desde = `${meses[0]}-01`
  const recebidoDe = (ticker, filtro = () => true) => (recebidos
    ? recebidos.filter((p) => p.ticker === ticker && p.data >= desde && filtro(p)).reduce((x, p) => x + p.valor, 0)
    : (Array.isArray(provs[ticker]) ? provs[ticker] : []).filter(filtro).reduce((x, p) => x + p.valor * cotasNaDataEx(transacoes, ticker, p.data), 0))
  const semDados = linhas.filter((l) => !l.prov12 && ['FII', 'ETF'].includes(l.tipo) && Array.isArray(provs[l.ticker]) && !provs[l.ticker].length)
  const porMes = meses.map((m) => ({
    mes: `${m}-01`,
    valor: linhas.reduce((a, l) => a + recebidoDe(l.ticker, (p) => p.data.startsWith(m)), 0),
  }))
  const pagadores = linhas.filter((l) => l.prov12 > 0 || recebidoDe(l.ticker) > 0).sort((a, b) => b.prov12 * b.quantidade - a.prov12 * a.quantidade)
  const total12 = porMes.reduce((a, m) => a + m.valor, 0)
  const meta = Number(metaRenda) || 0
  const falta = Math.max(0, meta - tot.renda)
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Proventos</h2>
        <label className="field" style={{ marginBottom: 0 }}>Meta de renda (R$/mês)
          <input type="number" min="0" step="100" placeholder="sem meta" value={metaRenda ?? ''} onChange={(e) => setMetaRenda(e.target.value === '' ? null : Number(e.target.value))} />
        </label>
      </div>
      {meta > 0 && (
        <div style={{ margin: '10px 0 4px' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
            <b className="num">{fmt.brl(tot.renda)}</b> de <b className="num">{fmt.brl(meta)}</b>/mês ({fmt.pct(Math.min(100, (tot.renda / meta) * 100), 0)})
            {falta > 0 && tot.dy > 0 && <> · faltam {fmt.brl(falta)}/mês ≈ <b className="num">{fmt.brl((falta * 12) / (tot.dy / 100))}</b> investidos ao DY atual da carteira ({fmt.pct(tot.dy)})</>}
            {falta === 0 && ' · meta atingida'}
          </div>
          <div className="stack" aria-hidden="true"><div style={{ width: `${Math.min(100, (tot.renda / meta) * 100)}%`, background: 'var(--series-3)' }} /></div>
        </div>
      )}
      <div className="grid two" style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Recebido por mês nos últimos 12 meses · pelas cotas em cada data ex</div>
          <BarChart data={total12 > 0 ? porMes : []} x="mes" y="valor" format={(v) => fmt.num(v, 2)} />
          <div className="muted" style={{ fontSize: 13 }}>Total 12 meses: <b className="num">{fmt.brl(total12)}</b> · média {fmt.brl(total12 / 12)}/mês</div>
          <div style={{ marginTop: 16 }}><Agenda agenda={agenda} /></div>
        </div>
        <div className="table-wrap cartoes" style={{ border: 0 }}>
          <table>
            <thead><tr><th className="txt">Ativo</th><th title="Pagamentos nos últimos 12 meses">Pagam.</th><th>Último (R$/cota)</th><th title="Recebido nos últimos 12 meses, pelas cotas que você tinha em cada data ex">Recebido 12m</th><th title="Proventos de 12 meses por cota x cotas de hoje">Renda/ano hoje</th><th title="Proventos de 12 meses ÷ preço médio">Yield on cost</th></tr></thead>
            <tbody>
              {pagadores.map((l) => {
                const lista = Array.isArray(provs[l.ticker]) ? provs[l.ticker] : []
                const ult = lista[lista.length - 1]
                return (
                  <tr key={l.ticker} style={{ cursor: 'default' }}>
                    <td className="txt"><span className="dot" style={{ background: cor(l.i) }} />{l.ticker}</td>
                    <td className="num">{lista.length || '—'}</td>
                    <td className="num">{ult ? <>{fmt.num(ult.valor, 4)} <span className="muted">{fmt.date(ult.data)}</span></> : '—'}</td>
                    <td className="num">{fmt.brl(recebidoDe(l.ticker))}</td>
                    <td className="num">{fmt.brl(l.prov12 * l.quantidade)}</td>
                    <td className="num">{l.preco_medio ? fmt.pct((l.prov12 / l.preco_medio) * 100) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!pagadores.length && <div className="empty">Nenhum ativo da carteira pagou proventos nos últimos 12 meses.</div>}
        </div>
      </div>
      {semDados.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          Sem dados de proventos de {semDados.map((l) => l.ticker).join(', ')} no Yahoo nem na base: se {semDados.length > 1 ? 'eles pagam' : 'ele paga'}, a renda aparece zerada aqui.
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Proventos por data ex (Yahoo Finance), brutos de imposto; quem compra na data ex só recebe no pagamento seguinte. Yield on cost compara a renda com o que você pagou; DY 12m, com o preço de hoje.</p>
    </div>
  )
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
  }, [chave, periodo, ['1d', '24h'].includes(periodo) ? tick : 0])
  return [serie, erro]
}

export default function HomeBroker({ onOpen, onSimular }) {
  const [estado, setEstado] = useState(carregar)
  const [cot, setCot] = useState({})
  const [info, setInfo] = useState({})
  const [provs, setProvs] = useState({})
  const [atualizado, setAtualizado] = useState(null)
  const [auto, setAuto] = useState(true)
  const [tick, setTick] = useState(0)
  const [periodo, setPeriodo] = useState('1d')
  const [ordem, setOrdem] = useState({ col: 'valor', dir: -1 })
  const arquivo = useRef(null)
  const [recebida, setRecebida] = useState(null) // carteira vinda de um link compartilhado
  const [copiado, setCopiado] = useState(null)

  useEffect(() => {
    carteiraDoLink().then((c) => c && setRecebida(c)).catch(() => setRecebida({ erro: true }))
  }, [])

  const carteira = estado.carteiras.find((c) => c.id === estado.ativa) || estado.carteiras[0]
  const transacoes = carteira?.transacoes || []
  // posições: as do desempenho (base atual, já com desdobramentos) quando chegam; até lá, as locais
  const [desemp, erroDesemp] = useDesempenho(transacoes)
  const posicoes = useMemo(() => {
    const locais = carteira?.posicoes || []
    if (!desemp?.posicoes) return locais
    const doBack = new Set(desemp.posicoes.map((p) => p.ticker))
    // ativos sem histórico ficam fora do cálculo do servidor: mantém a posição local deles
    const semHistorico = locais.filter((p) => !doBack.has(p.ticker) && desemp.avisos.some((a) => a.startsWith(`${p.ticker}:`)))
    return [...desemp.posicoes, ...semHistorico]
  }, [carteira, desemp])
  const tickers = posicoes.map((p) => p.ticker)

  const atualizarEstado = (fn) => setEstado((e) => salvar(fn(e)))
  const setTransacoes = (fn) => atualizarEstado((e) => ({
    ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, transacoes: fn(c.transacoes || []) } : c)),
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

  // agenda estimada dos próximos 12 meses (pela regularidade dos pagamentos)
  const [agenda, setAgenda] = useState(null)
  const chavePos = posicoes.map((p) => `${p.ticker}:${p.quantidade}`).join(',')
  useEffect(() => {
    setAgenda(null)
    if (!posicoes.length) return
    let vivo = true
    const t = setTimeout(() => api.agenda(posicoes.map(({ ticker, quantidade }) => ({ ticker, quantidade })))
      .then((a) => vivo && setAgenda(a)).catch(() => {}), 600)
    return () => { vivo = false; clearTimeout(t) }
  }, [chavePos])

  // proventos por cota dos últimos 12 meses (Yahoo): ações, FIIs e ETFs
  useEffect(() => {
    const pagaveis = tickers.filter((t) => !ehCripto(t) && !ehRendaFixa(t))
    if (!pagaveis.length) return
    api.proventosRecentes(pagaveis).then(setProvs).catch(() => {})
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
    const yh = provs[p.ticker]?.length ? provs[p.ticker].reduce((a, x) => a + x.valor, 0) : null // sem dados no Yahoo: usa a base
    const prov12 = d.tipo === 'CRIPTO' || ehCripto(p.ticker) || ehRendaFixa(p.ticker) ? 0 : (yh ?? d.proventos_12m)
    return {
      ...p, i, preco, valor, custo, nome: q.nome || d.nome_pregao || d.razao_social, erro: q.erro,
      var_pct: q.variacao_pct, var_dia: varDia, resultado: valor != null && custo ? valor - custo : null,
      resultado_pct: valor != null && custo ? (valor / custo - 1) * 100 : null,
      tipo: d.tipo || (ehCripto(p.ticker) ? 'CRIPTO' : ehRendaFixa(p.ticker) ? 'RF' : null), codigo: d.codigo,
      dy: prov12 && preco ? (prov12 / preco) * 100 : d.tipo === 'CRIPTO' ? null : d.dividend_yield, prov12,
      renda_mes: prov12 ? (prov12 * p.quantidade) / 12 : null, yoc: prov12 && p.preco_medio ? (prov12 / p.preco_medio) * 100 : null,
    }
  }), [posicoes, cot, info, provs])

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
  const criar = (nome, pos = [], ops = null) => setEstado(novaCarteira(nome, pos, ops))
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
      const nome = d.nome || f.name.replace(/\.json$/i, '')
      if (Array.isArray(d.transacoes)) criar(nome, [], d.transacoes)
      else if (Array.isArray(pos)) criar(nome, pos)
      else throw new Error('formato')
    }).catch(() => window.alert('Arquivo inválido: esperado um JSON exportado daqui ({ nome, transacoes }) ou { nome, posicoes: [{ ticker, quantidade, preco_medio }] }.'))
    e.target.value = ''
  }
  const remover = (ticker) => {
    if (window.confirm(`Apagar todas as operações de ${ticker} desta carteira?`)) setTransacoes((ts) => ts.filter((t) => t.ticker !== ticker))
  }
  const th = (col, label, cls = '') => (
    <th className={`${cls} ${ordem.col === col ? 'sorted' : ''}`} onClick={() => setOrdem((o) => ({ col, dir: o.col === col ? -o.dir : -1 }))}>
      {label}{ordem.col === col ? (ordem.dir < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const compartilhar = async () => {
    const link = await linkDaCarteira(carteira)
    try { await navigator.clipboard.writeText(link); setCopiado('Link copiado') } catch { window.prompt('Copie o link da carteira:', link); setCopiado(null) }
    setTimeout(() => setCopiado(null), 3000)
  }
  const avisoLink = recebida && (
    <div className="alert section" style={{ marginBottom: 12 }}>
      {recebida.erro ? 'Link de carteira inválido ou corrompido.' : (
        <>
          Link de carteira compartilhada: <b>{recebida.nome}</b> · {recebida.transacoes.length} operações.
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={() => {
              const e = novaCarteira(recebida.nome, [], recebida.transacoes)
              setEstado(recebida.meta_renda ? salvar({ ...e, carteiras: e.carteiras.map((c) => (c.id === e.ativa ? { ...c, meta_renda: recebida.meta_renda } : c)) }) : e)
              setRecebida(null); limparLink()
            }}>Importar neste navegador</button>
            <button className="btn" onClick={() => { setRecebida(null); limparLink() }}>Ignorar</button>
          </div>
        </>
      )}
    </div>
  )

  if (!carteira) {
    return (
      <>
        <h1>Home Broker</h1>
        {avisoLink}
        <p className="sub">Acompanhe uma carteira em tempo real: patrimônio, variação do dia, resultado por ativo e renda estimada. As carteiras ficam salvas só neste navegador.</p>
        <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn primary" onClick={() => criar('Minha carteira')}>Criar carteira vazia</button>
          <button className="btn" onClick={() => criar('Carteira de exemplo', EXEMPLO)}>Começar com um exemplo</button>
          <button className="btn" onClick={() => arquivo.current?.click()}>Importar JSON</button>
          <input ref={arquivo} type="file" accept="application/json,.json" hidden onChange={importar} />
          <span className="muted" style={{ fontSize: 13 }}>Também dá para trazer uma carteira otimizada pela aba Markowitz.</span>
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
      {avisoLink && <div style={{ marginTop: 12 }}>{avisoLink}</div>}

      <div className="filters" style={{ marginTop: 12 }}>
        <label className="field">Carteira
          <select value={carteira.id} onChange={(e) => atualizarEstado((s) => ({ ...s, ativa: e.target.value }))}>
            {estado.carteiras.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => criar(`Carteira ${estado.carteiras.length + 1}`)}>Nova</button>
        <button className="btn" onClick={renomear}>Renomear</button>
        <button className="btn" onClick={exportar}>Exportar</button>
        <button className="btn" onClick={compartilhar} title="Link com as operações desta carteira (vai no próprio link; não fica salvo em servidor)">{copiado || 'Compartilhar link'}</button>
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
              {PERIODOS.map((p) => <button key={p.k} className={periodo === p.k ? 'on' : ''} title={TITULOS[p.k]} onClick={() => setPeriodo(p.k)}>{p.l}</button>)}
            </div>
          </div>
          {serie ? (
            <>
              <div className="muted" style={{ fontSize: 13, margin: '6px 0' }}>
                {per.l}: <b className={`num ${signClass(fim - inicio)}`}>{fim - inicio >= 0 ? '+' : ''}{fmt.brl(fim - inicio)} ({signed((fim / inicio - 1) * 100)})</b>
                {' '}· quantidades de hoje aplicadas aos preços de cada momento
              </div>
              <MultiLineChart datas={serie.datas} series={[{ nome: 'Carteira', valores: serie.valores, cor: 'var(--series-1)' }]}
                fmtY={(v) => fmt.brl(v)} label="Valor da carteira no período"
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

      {posicoes.length > 0 && (
        <Proventos linhas={linhas} provs={provs} tot={tot} metaRenda={carteira.meta_renda} transacoes={transacoes} recebidos={desemp?.proventos_recebidos} agenda={agenda}
          setMetaRenda={(v) => atualizarEstado((e) => ({ ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, meta_renda: v } : c)) }))} />
      )}

      {posicoes.length > 0 && tot.cotado && (
        <Rebalanceamento linhas={linhas} tot={tot} alvos={carteira.alvos} tolerancia={carteira.tolerancia ?? 5}
          setAlvos={(al) => atualizarEstado((e) => ({ ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, alvos: al } : c)) }))}
          setTolerancia={(v) => atualizarEstado((e) => ({ ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, tolerancia: v } : c)) }))} />
      )}

      {posicoes.length > 0 && (
        <Alertas alertas={carteira.alertas || []} linhas={linhas}
          setAlertas={(al) => atualizarEstado((e) => ({ ...e, carteiras: e.carteiras.map((c) => (c.id === carteira.id ? { ...c, alertas: al } : c)) }))} />
      )}

      <Operacoes transacoes={transacoes} setTransacoes={setTransacoes}
        onImportarB3={(ops, arquivo) => criar(`B3 · ${arquivo.replace(/\.(xlsx|xls|csv)$/i, '')}`, [], ops)} />

      <Desempenho transacoes={transacoes} d={desemp} erro={erroDesemp} />

      <ImpostoVendas d={desemp} />

      <Declaracao irpf={desemp?.irpf} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Posições</h2>
        <div className="table-wrap cartoes" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                {th('ticker', 'Ativo', 'txt')}{th('quantidade', 'Qtd.')}{th('preco_medio', 'Preço médio')}{th('preco', 'Preço')}
                {th('var_pct', 'Dia %')}{th('var_dia', 'Dia R$')}{th('valor', 'Valor')}{th('peso', 'Peso')}
                {th('resultado', 'Resultado')}{th('resultado_pct', 'Result. %')}{th('dy', 'DY 12m')}{th('yoc', 'YoC')}{th('renda_mes', 'Renda/mês')}
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
                  <td className="num">{qtdFmt(l.quantidade)}</td>
                  <td className="num">{fmt.preco(l.preco_medio)}</td>
                  <td className="num"><b>{l.preco != null ? fmt.preco(l.preco) : '…'}</b></td>
                  <td className={`num ${signClass(l.var_pct)}`}>{signed(l.var_pct)}</td>
                  <td className={`num ${signClass(l.var_dia)}`}>{l.var_dia != null ? fmt.brl(l.var_dia) : '—'}</td>
                  <td className="num">{fmt.brl(l.valor)}</td>
                  <td className="num">{l.valor != null && tot.valor ? fmt.pct((l.valor / tot.valor) * 100, 1) : '—'}</td>
                  <td className={`num ${signClass(l.resultado)}`}>{l.resultado != null ? fmt.brl(l.resultado) : '—'}</td>
                  <td className={`num ${signClass(l.resultado_pct)}`}>{signed(l.resultado_pct)}</td>
                  <td className="num">{fmt.pct(l.dy)}</td>
                  <td className="num" title="Yield on cost: proventos de 12 meses ÷ preço médio">{fmt.pct(l.yoc)}</td>
                  <td className="num">{l.renda_mes ? fmt.brl(l.renda_mes) : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="chip" style={{ padding: '0 6px' }} aria-label={`Remover ${l.ticker}`} onClick={() => remover(l.ticker)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!posicoes.length && <div className="empty">Carteira vazia — registre a primeira compra em Operações, acima.</div>}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Quantidades fracionárias valem para cripto (ex.: 0,0012 BTC-BRL) e renda fixa (lançada em reais). Posições = operações pelo custo médio. Renda estimada = proventos pagos nos últimos 12 meses ÷ 12 (Yahoo Finance; sem cripto).
          Somente acompanhamento: não envia ordens.
        </p>
      </div>
    </>
  )
}

