import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../api.js'
import { fmt } from '../../format.js'
import { calcular, compilar, EXEMPLOS, FUNCOES, PADRAO, series, VARIAVEIS } from '../../lib/formulas.js'
import BuscaAtivo from '../BuscaAtivo.jsx'
import { MultiLineChart } from '../Charts.jsx'
import { LiveQuote } from '../Detail.jsx'
import { cor, intervaloPadrao, SeletorPeriodo } from './comum.jsx'

const uid = () => Math.random().toString(36).slice(2, 9)

// Cada indicador (padrão ou customizado) vira um item { id, tipo, params } | { id, custom: true, nome, expr, painel }
function linhasDe(item) {
  if (item.custom) return [[item.nome, item.expr]]
  const def = PADRAO[item.tipo]
  return def.linhas({ ...def.params, ...item.params })
}

function Referencia({ onUsar }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Referência da linguagem de fórmulas</summary>
      <div style={{ fontSize: 12, marginTop: 8, display: 'grid', gap: 8 }}>
        <div><b>Variáveis:</b> {Object.entries(VARIAVEIS).map(([k, v]) => <span key={k}><code>{k}</code> ({v}) · </span>)}</div>
        <div><b>Operadores:</b> <code>+ - * / ^</code> e parênteses. Séries e números se combinam ponto a ponto.</div>
        <div><b>Funções:</b> {Object.entries(FUNCOES).map(([k, f]) => <span key={k} title={f.desc}><code>{k}({f.args})</code> · </span>)}</div>
        <div><b>Exemplos</b> (clique para usar):
          <div className="chips" style={{ marginTop: 4 }}>
            {EXEMPLOS.map(([n, e]) => <button key={n} className="chip" onClick={() => onUsar(n, e)} title={e}>{n}</button>)}
          </div>
        </div>
      </div>
    </details>
  )
}

export default function ViewIndicadores({ view, onChange }) {
  const { ticker, periodo = '1y', itens = [] } = view
  const [hist, setHist] = useState(null)
  const [erro, setErro] = useState(null)
  const [tipoNovo, setTipoNovo] = useState('sma')
  const [nome, setNome] = useState('')
  const [expr, setExpr] = useState('')
  const [painel, setPainel] = useState('proprio')
  const [erroExpr, setErroExpr] = useState(null)

  const set = (patch) => onChange({ ...view, ...patch })

  useEffect(() => {
    if (!ticker) return
    setHist(null); setErro(null)
    api.historico(ticker, periodo, intervaloPadrao(periodo)).then(setHist).catch((e) => setErro(e.message))
  }, [ticker, periodo])

  const dados = useMemo(() => (hist ? series(hist) : null), [hist])
  const datas = useMemo(() => (hist ? hist.map((h) => h.data) : []), [hist])

  // calcula todas as linhas; erro em uma fórmula não derruba as outras
  const calculados = useMemo(() => {
    if (!dados) return []
    return itens.map((it, k) => {
      const linhas = linhasDe(it)
      try {
        return { it, k, linhas: linhas.map(([n, f, tracejado]) => ({ nome: n, valores: calcular(f, dados), tracejado })) }
      } catch (e) { return { it, k, erro: e.message, linhas: [] } }
    })
  }, [dados, itens])

  const painelDe = (it) => (it.custom ? it.painel : PADRAO[it.tipo].painel)
  // cor por indicador (a entidade), na ordem em que foi adicionado; o preço fica com a 1ª cor
  const sobrepostos = calculados.filter((c) => painelDe(c.it) === 'preco')
  const proprios = calculados.filter((c) => painelDe(c.it) === 'proprio')

  const addPadrao = () => set({ itens: [...itens, { id: uid(), tipo: tipoNovo, params: { ...PADRAO[tipoNovo].params } }] })
  const addCustom = () => {
    try {
      compilar(expr)
      set({ itens: [...itens, { id: uid(), custom: true, nome: nome.trim() || expr.slice(0, 24), expr, painel }] })
      setNome(''); setExpr(''); setErroExpr(null)
    } catch (e) { setErroExpr(e.message) }
  }
  const remover = (id) => set({ itens: itens.filter((i) => i.id !== id) })
  const setParam = (id, k, v) => set({ itens: itens.map((i) => (i.id === id ? { ...i, params: { ...i.params, [k]: Math.max(1, Math.round(Number(v) || 1)) } } : i)) })

  return (
    <>
      <div className="card">
        <div className="filters">
          <BuscaAtivo onAdd={(t) => set({ ticker: t })} label="Ativo" width={240} />
          <div className="field">Período<SeletorPeriodo periodo={periodo} onChange={(p) => set({ periodo: p })} /></div>
        </div>
        {ticker ? <LiveQuote ticker={ticker} /> : <div className="muted">Escolha um ativo para começar.</div>}
      </div>

      <div className="grid two section">
        <div className="card">
          <h2>Fórmulas padrão</h2>
          <div className="filters" style={{ marginBottom: 8 }}>
            <label className="field">Indicador
              <select value={tipoNovo} onChange={(e) => setTipoNovo(e.target.value)}>
                {Object.entries(PADRAO).map(([k, d]) => <option key={k} value={k}>{d.nome}{d.painel === 'preco' ? ' (sobre o preço)' : ''}</option>)}
              </select>
            </label>
            <button className="btn primary" onClick={addPadrao}>Adicionar</button>
          </div>
          {itens.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nenhum indicador ainda.</div>}
          {calculados.map(({ it, erro: e }) => (
            <div key={it.id} className="ind-row">
              <span className="dot" style={{ background: cor(painelDe(it) === 'preco' ? sobrepostos.findIndex((c) => c.it.id === it.id) + 1 : 0) }} />
              <b>{it.custom ? it.nome : PADRAO[it.tipo].nome}</b>
              {it.custom ? <code className="muted" style={{ fontSize: 11 }}>{it.expr}</code> : Object.entries(it.params).map(([k, v]) => (
                <label key={k} className="muted" style={{ fontSize: 12 }}>{k}
                  <input type="number" value={v} min="1" onChange={(ev) => setParam(it.id, k, ev.target.value)} style={{ width: 56, marginLeft: 4 }} />
                </label>
              ))}
              {e && <span className="neg" style={{ fontSize: 12 }}>{e}</span>}
              <button className="chip" style={{ marginLeft: 'auto' }} onClick={() => remover(it.id)} aria-label="Remover">✕</button>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Fórmula customizada</h2>
          <div className="filters" style={{ marginBottom: 6 }}>
            <label className="field">Nome<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Spread de médias" /></label>
            <label className="field">Exibir
              <select value={painel} onChange={(e) => setPainel(e.target.value)}>
                <option value="proprio">Em gráfico próprio</option>
                <option value="preco">Sobre o preço (mesma escala)</option>
              </select>
            </label>
          </div>
          <textarea className="formula" rows={2} value={expr} placeholder="ex.: (close / sma(close, 200) - 1) * 100"
            onChange={(e) => { setExpr(e.target.value); setErroExpr(null) }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <button className="btn primary" onClick={addCustom} disabled={!expr.trim()}>Adicionar fórmula</button>
            {erroExpr && <span className="neg" style={{ fontSize: 13 }}>{erroExpr}</span>}
          </div>
          <Referencia onUsar={(n, e) => { setNome(n); setExpr(e); setErroExpr(null) }} />
        </div>
      </div>

      {erro && <div className="alert section">{erro}</div>}
      {ticker && !hist && !erro && <div className="empty">Carregando histórico…</div>}
      {dados && (
        <>
          <div className="card section">
            <h2>{ticker} · preço{sobrepostos.length ? ' e sobreposições' : ''}</h2>
            <MultiLineChart datas={datas} height={300} label={`Preço de ${ticker}`}
              series={[
                { nome: `${ticker} fechamento`, cor: cor(0), valores: dados.close },
                ...sobrepostos.flatMap((c, j) => c.linhas.map((l) => ({ ...l, cor: cor(j + 1) }))),
              ]} />
          </div>
          {proprios.map((c) => {
            const def = c.it.custom ? {} : PADRAO[c.it.tipo]
            const refs = [...(def.faixa || []).map((y) => ({ y, label: String(y) })), ...(def.zero ? [{ y: 0 }] : [])]
            return (
              <div className="card section" key={c.it.id}>
                <h2>{c.it.custom ? c.it.nome : def.nome}</h2>
                {c.erro ? <div className="alert">{c.erro}</div> : (
                  <MultiLineChart datas={datas} height={180} refs={refs} label={c.it.custom ? c.it.nome : def.nome}
                    fmtY={(v) => (Math.abs(v) >= 1e4 ? fmt.big(v, '') : fmt.num(v))}
                    series={c.linhas.map((l, j) => ({ ...l, cor: cor(j) }))} />
                )}
              </div>
            )
          })}
        </>
      )}
    </>
  )
}
