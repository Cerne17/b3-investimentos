import React, { useState } from 'react'
import { api } from '../api.js'
import { fmt, signClass } from '../format.js'
import ResultadoAporte from './ResultadoAporte.jsx'

// Pesos-alvo da carteira: desvio de cada ativo, aviso quando passa da tolerância e o aporte que corrige (só compras).
export default function Rebalanceamento({ linhas, tot, alvos, setAlvos, tolerancia = 5, setTolerancia, congelados = {}, setCongelados }) {
  const [aporte, setAporte] = useState('')
  const [vender, setVender] = useState(false)
  const [sugestao, setSugestao] = useState(null)
  const [erro, setErro] = useState(null)
  const definido = alvos && Object.keys(alvos).length > 0
  const soma = definido ? Object.values(alvos).reduce((a, b) => a + (Number(b) || 0), 0) : 0
  const tickers = [...new Set([...linhas.map((l) => l.ticker), ...Object.keys(alvos || {})])]
  const valor = (t) => linhas.find((l) => l.ticker === t)?.valor || 0
  const atual = (t) => (tot.valor ? (valor(t) / tot.valor) * 100 : 0)
  const alvoDe = (t) => (soma ? ((Number(alvos[t]) || 0) / soma) * 100 : 0)
  const fora = definido ? tickers.filter((t) => Math.abs(atual(t) - alvoDe(t)) > tolerancia) : []

  const usarAtuais = () => setAlvos(Object.fromEntries(linhas.filter((l) => l.valor > 0).map((l) => [l.ticker, +((l.valor / tot.valor) * 100).toFixed(1)])))
  const sugerir = () => {
    setErro(null); setSugestao(null)
    api.aporte({
      tickers, pesos: tickers.map((t) => alvoDe(t) / 100),
      quantidades: tickers.map((t) => linhas.find((l) => l.ticker === t)?.quantidade || 0), aporte: Number(aporte) || 0,
      permitir_venda: vender, congelados: Object.keys(congelados).length ? congelados : null,
      precos_medios: tickers.map((t) => linhas.find((l) => l.ticker === t)?.preco_medio || 0),
    }).then(setSugestao).catch((e) => setErro(e.message))
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Rebalanceamento</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted" style={{ fontSize: 13 }}>Tolerância
            <input type="number" min="0.5" step="0.5" value={tolerancia} style={{ width: 60, marginLeft: 6 }} onChange={(e) => setTolerancia(Number(e.target.value))} /> p.p.
          </label>
          <button className="btn" onClick={usarAtuais}>{definido ? 'Redefinir com os pesos de hoje' : 'Definir alvo com os pesos de hoje'}</button>
        </div>
      </div>
      {!definido ? (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Defina um peso-alvo por ativo (ou use os pesos de hoje, ou os de uma carteira otimizada no Markowitz com "Acompanhar no Home Broker")
          para ver o desvio e o aporte que corrige.
        </p>
      ) : (
        <>
          {fora.length > 0
            ? <div className="alert section" style={{ marginTop: 8 }}>Fora da tolerância de {fmt.num(tolerancia, 1)} p.p.: {fora.join(', ')}.</div>
            : <p className="muted" style={{ fontSize: 13 }}>Todos os ativos dentro de {fmt.num(tolerancia, 1)} p.p. do alvo.</p>}
          <div className="table-wrap cartoes" style={{ border: 0 }}>
            <table>
              <thead><tr><th className="txt">Ativo</th><th>Hoje</th><th>Alvo (%)</th><th>Desvio</th><th>Para o alvo</th><th className="txt" title="Ativos que você não pode ou não quer comprar">Congelar</th></tr></thead>
              <tbody>
                {tickers.map((t) => {
                  const d = atual(t) - alvoDe(t)
                  return (
                    <tr key={t} style={{ cursor: 'default' }}>
                      <td className="txt">{t}{Math.abs(d) > tolerancia ? ' ⚠' : ''}</td>
                      <td className="num">{fmt.pct(atual(t), 1)}</td>
                      <td className="num">
                        <input className="hb-edit" type="number" min="0" step="0.5" value={alvos[t] ?? ''} placeholder="0"
                          onChange={(e) => setAlvos({ ...alvos, [t]: e.target.value === '' ? 0 : Number(e.target.value) })} aria-label={`Alvo de ${t}`} />
                      </td>
                      <td className={`num ${Math.abs(d) > tolerancia ? signClass(-Math.abs(d)) : ''}`}>{d >= 0 ? '+' : ''}{fmt.num(d, 1)} p.p.</td>
                      <td className="num">{fmt.brl((alvoDe(t) / 100) * tot.valor - valor(t))}</td>
                      <td className="txt">
                        <select value={congelados[t] || ''} aria-label={`Congelar ${t}`}
                          onChange={(e) => { const n = { ...congelados }; if (e.target.value) n[t] = e.target.value; else delete n[t]; setCongelados(n) }}>
                          <option value="">livre</option><option value="nao_comprar">não comprar</option><option value="manter">manter</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {Math.abs(soma - 100) > 0.5 && <p className="muted" style={{ fontSize: 12 }}>Os alvos somam {fmt.num(soma, 1)}%: são normalizados para 100%.</p>}
          <form className="filters" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); sugerir() }}>
            <label className="field">Aporte (R$)<input type="number" min="0" step="100" value={aporte} placeholder={vender ? '0' : ''} onChange={(e) => setAporte(e.target.value)} /></label>
            <label className="field" title="Vende o que passou do alvo para comprar o que ficou abaixo">
              <span><input type="checkbox" checked={vender} onChange={(e) => { setVender(e.target.checked); setSugestao(null) }} /> Permitir vendas</span>
            </label>
            <button className="btn primary" disabled={!(Number(aporte) > 0) && !vender}>{vender ? 'Rebalancear' : 'Onde aportar'}</button>
          </form>
          {erro && <div className="alert">{erro}</div>}
          {sugestao && <ResultadoAporte r={sugestao} />}
        </>
      )}
    </div>
  )
}
