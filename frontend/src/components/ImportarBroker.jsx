import React, { useState } from 'react'
import { api } from '../api.js'
import { carregar } from '../lib/broker.js'

// Seletor que traz uma carteira do Home Broker (localStorage), ou todas juntas.
// onInicio({ nome, tickers }) roda na hora; onValores({ tickers, valores, total }) depois das cotações,
// com o valor de mercado de cada ativo (preço médio quando falta cotação) e as quantidades somadas.
export default function ImportarBroker({ onInicio, onValores }) {
  const [carteiras] = useState(() => carregar().carteiras.filter((c) => c.posicoes.length))
  if (!carteiras.length) return null

  const importar = async (id) => {
    if (!id) return
    const escolhidas = id === '*' ? carteiras : carteiras.filter((c) => c.id === id)
    const posicoes = escolhidas.flatMap((c) => c.posicoes)
    const tickers = [...new Set(posicoes.map((p) => p.ticker))]
    onInicio?.({ nome: id === '*' ? `${escolhidas.length} carteiras do Home Broker` : escolhidas[0].nome, tickers })
    let cot = {}
    try { cot = await api.cotacoes(tickers) } catch {}
    const valores = tickers.map((t) => posicoes.filter((p) => p.ticker === t)
      .reduce((s, p) => s + p.quantidade * (cot[t]?.preco || p.preco_medio), 0))
    const total = valores.reduce((a, b) => a + b, 0)
    const quantidades = tickers.map((t) => posicoes.filter((p) => p.ticker === t).reduce((s, p) => s + p.quantidade, 0))
    if (total > 0) onValores?.({ tickers, valores, total, quantidades })
  }

  return (
    <label className="field">Importar do Home Broker
      <select value="" onChange={(e) => importar(e.target.value)}>
        <option value="">Escolha uma carteira…</option>
        {carteiras.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.posicoes.length} {c.posicoes.length === 1 ? 'ativo' : 'ativos'})</option>)}
        {carteiras.length > 1 && <option value="*">Todas juntas</option>}
      </select>
    </label>
  )
}
