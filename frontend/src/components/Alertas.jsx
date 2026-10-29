import React, { useEffect, useState } from 'react'
import { fmt, signed } from '../format.js'

const TIPOS = {
  acima: { nome: 'Preço acima de', un: 'R$', teste: (l, v) => l.preco >= v, texto: (l) => `${l.ticker} a ${fmt.preco(l.preco)}` },
  abaixo: { nome: 'Preço abaixo de', un: 'R$', teste: (l, v) => l.preco <= v, texto: (l) => `${l.ticker} a ${fmt.preco(l.preco)}` },
  queda: { nome: 'Queda no dia de', un: '%', teste: (l, v) => l.var_pct <= -v, texto: (l) => `${l.ticker} ${signed(l.var_pct)} hoje` },
  alta: { nome: 'Alta no dia de', un: '%', teste: (l, v) => l.var_pct >= v, texto: (l) => `${l.ticker} ${signed(l.var_pct)} hoje` },
  dy: { nome: 'DY 12m acima de', un: '%', teste: (l, v) => l.dy >= v, texto: (l) => `${l.ticker} com DY de ${fmt.pct(l.dy)}` },
}
const hoje = () => new Date().toISOString().slice(0, 10)
const id = () => Math.random().toString(36).slice(2, 10)

// Alertas da carteira, checados a cada atualização de cotação enquanto a página está aberta. Cada alerta dispara no
// máximo uma vez por dia; com permissão, vira também notificação do navegador.
export default function Alertas({ alertas, setAlertas, linhas }) {
  const [novo, setNovo] = useState({ ticker: '', tipo: 'abaixo', valor: '' })
  const [permissao, setPermissao] = useState(() => (typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission))
  const porTicker = Object.fromEntries(linhas.map((l) => [l.ticker, l]))

  useEffect(() => {
    const disparados = []
    const novos = alertas.map((a) => {
      const l = porTicker[a.ticker]
      const tipo = TIPOS[a.tipo]
      if (!l || !tipo || a.disparado_em === hoje() || !Number.isFinite(l.preco)) return a
      if (!tipo.teste(l, a.valor)) return a
      disparados.push(`${tipo.nome} ${a.un === '%' ? fmt.pct(a.valor) : fmt.preco(a.valor)}: ${tipo.texto(l)}`)
      return { ...a, disparado_em: hoje(), ultimo: tipo.texto(l) }
    })
    if (!disparados.length) return
    setAlertas(novos)
    if (permissao === 'granted') disparados.forEach((t) => { try { new Notification('B3 · alerta da carteira', { body: t }) } catch {} })
  }, [linhas])

  const adicionar = (e) => {
    e.preventDefault()
    if (!novo.ticker || !(Number(novo.valor) > 0)) return
    setAlertas([...alertas, { id: id(), ticker: novo.ticker, tipo: novo.tipo, valor: Number(novo.valor), un: TIPOS[novo.tipo].un }])
    setNovo({ ...novo, valor: '' })
  }
  const pedirPermissao = () => Notification.requestPermission().then(setPermissao)
  const ativosHoje = alertas.filter((a) => a.disparado_em === hoje())

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Alertas{ativosHoje.length ? ` · ${ativosHoje.length} hoje` : ''}</h2>
        {permissao === 'default' && <button className="btn" onClick={pedirPermissao}>Ativar notificações do navegador</button>}
        {permissao === 'denied' && <span className="muted" style={{ fontSize: 12 }}>Notificações bloqueadas no navegador: os alertas aparecem só aqui.</span>}
      </div>
      {ativosHoje.length > 0 && (
        <div className="alert section" style={{ marginTop: 8 }}>
          {ativosHoje.map((a) => <div key={a.id}>🔔 {TIPOS[a.tipo].nome} {a.un === '%' ? fmt.pct(a.valor) : fmt.preco(a.valor)} — {a.ultimo}</div>)}
        </div>
      )}
      <form className="filters" onSubmit={adicionar} style={{ margin: '10px 0 6px' }}>
        <label className="field">Ativo
          <select value={novo.ticker} onChange={(e) => setNovo({ ...novo, ticker: e.target.value })}>
            <option value="">Escolha…</option>
            {linhas.map((l) => <option key={l.ticker} value={l.ticker}>{l.ticker}</option>)}
          </select>
        </label>
        <label className="field">Quando
          <select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>
            {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t.nome}</option>)}
          </select>
        </label>
        <label className="field">{TIPOS[novo.tipo].un === '%' ? 'Valor (%)' : 'Valor (R$)'}
          <input type="number" step="any" min="0" value={novo.valor}
            placeholder={novo.ticker && porTicker[novo.ticker]?.preco && TIPOS[novo.tipo].un === 'R$' ? fmt.num(porTicker[novo.ticker].preco, 2) : ''}
            onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
        </label>
        <button className="btn primary" disabled={!novo.ticker || !(Number(novo.valor) > 0)}>Criar alerta</button>
      </form>
      {alertas.length > 0 ? (
        <div className="chips" style={{ gap: 8 }}>
          {alertas.map((a) => (
            <span key={a.id} className="sel-chip" title={a.disparado_em ? `Último disparo: ${fmt.date(a.disparado_em)}` : 'Ainda não disparou'}>
              {a.disparado_em === hoje() ? '🔔 ' : ''}{a.ticker} · {TIPOS[a.tipo]?.nome.toLowerCase()} {a.un === '%' ? fmt.pct(a.valor) : fmt.preco(a.valor)}
              <button onClick={() => setAlertas(alertas.filter((x) => x.id !== a.id))} aria-label={`Apagar alerta de ${a.ticker}`}>✕</button>
            </span>
          ))}
        </div>
      ) : <div className="muted" style={{ fontSize: 13 }}>Nenhum alerta. Eles são checados a cada atualização de cotação (30 s) enquanto esta página está aberta.</div>}
    </div>
  )
}
