import React, { useEffect, useState } from 'react'
import ViewComparacao from './ViewComparacao.jsx'
import ViewIndicadores from './ViewIndicadores.jsx'
import ViewPadrao from './ViewPadrao.jsx'

const CHAVE = 'tempo_real_views'
const TIPOS = {
  indicadores: { nome: 'Indicadores', desc: 'Um ativo com fórmulas padrão e customizadas', novo: { ticker: 'BOVA11', periodo: '1y', itens: [] } },
  comparacao: { nome: 'Comparação', desc: 'Dois ou mais ativos no mesmo gráfico', novo: { tickers: ['BOVA11', 'IVVB11'], periodo: '1y', modo: 'base100' } },
}

// views ficam no navegador (preferência pessoal); a view padrão é fixa
const carregar = () => {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || [] } catch { return [] }
}

export default function Live() {
  const [views, setViews] = useState(carregar)
  const [ativa, setAtiva] = useState(() => { try { return localStorage.getItem(CHAVE + '_ativa') || 'padrao' } catch { return 'padrao' } })
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('indicadores')
  const [renomeando, setRenomeando] = useState(null)

  useEffect(() => { try { localStorage.setItem(CHAVE, JSON.stringify(views)) } catch {} }, [views])
  useEffect(() => { try { localStorage.setItem(CHAVE + '_ativa', ativa) } catch {} }, [ativa])

  const view = views.find((v) => v.id === ativa)
  const atualizar = (nova) => setViews((vs) => vs.map((v) => (v.id === nova.id ? nova : v)))
  const criar = (e) => {
    e.preventDefault()
    const id = Math.random().toString(36).slice(2, 9)
    const n = nome.trim() || `${TIPOS[tipo].nome} ${views.filter((v) => v.tipo === tipo).length + 1}`
    setViews([...views, { id, tipo, nome: n, ...TIPOS[tipo].novo }])
    setAtiva(id); setCriando(false); setNome('')
  }
  const excluir = (id) => {
    if (!window.confirm('Excluir esta view?')) return
    setViews(views.filter((v) => v.id !== id))
    if (ativa === id) setAtiva('padrao')
  }
  const duplicar = (v) => {
    const id = Math.random().toString(36).slice(2, 9)
    setViews([...views, { ...structuredClone(v), id, nome: `${v.nome} (cópia)` }])
    setAtiva(id)
  }

  return (
    <>
      <h1>Tempo real</h1>
      <p className="sub">Cotações do Yahoo Finance atualizadas a cada 30 s. Crie views para calcular indicadores sobre um ativo ou comparar vários. Aceita B3 (PETR4, HGLG11), EUA (AAPL), índices (^BVSP) e cripto (BTC-USD).</p>

      <div className="view-tabs">
        <button className={`tab ${ativa === 'padrao' ? 'active' : ''}`} onClick={() => setAtiva('padrao')}>Padrão</button>
        {views.map((v) => (
          renomeando === v.id ? (
            <input key={v.id} autoFocus defaultValue={v.nome} className="view-rename"
              onBlur={(e) => { atualizar({ ...v, nome: e.target.value.trim() || v.nome }); setRenomeando(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenomeando(null) }} />
          ) : (
            <button key={v.id} className={`tab ${ativa === v.id ? 'active' : ''}`} onClick={() => setAtiva(v.id)}
              onDoubleClick={() => setRenomeando(v.id)} title="Duplo clique para renomear">
              <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>{v.tipo === 'comparacao' ? '⇄' : 'ƒ'}</span>{v.nome}
            </button>
          )
        ))}
        <button className="tab" onClick={() => setCriando((c) => !c)}>+ Nova view</button>
        {view && (
          <span className="view-actions">
            <button className="chip" onClick={() => setRenomeando(view.id)}>Renomear</button>
            <button className="chip" onClick={() => duplicar(view)}>Duplicar</button>
            <button className="chip" onClick={() => excluir(view.id)}>Excluir</button>
          </span>
        )}
      </div>

      {criando && (
        <form className="card filters" onSubmit={criar} style={{ marginBottom: 16 }}>
          <label className="field">Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t.nome} — {t.desc}</option>)}
            </select>
          </label>
          <label className="field">Nome<input className="wide" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Ouro x Dólar" /></label>
          <button className="btn primary">Criar view</button>
          <button type="button" className="btn" onClick={() => setCriando(false)}>Cancelar</button>
        </form>
      )}

      {!view && <ViewPadrao />}
      {view?.tipo === 'indicadores' && <ViewIndicadores key={view.id} view={view} onChange={atualizar} />}
      {view?.tipo === 'comparacao' && <ViewComparacao key={view.id} view={view} onChange={atualizar} />}
    </>
  )
}
