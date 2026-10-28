import React from 'react'

export const CORES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
export const cor = (i) => CORES[i % CORES.length]

// Hoje = último pregão (cripto: desde 00:00 UTC); 1D e 1S = janelas móveis das últimas 24 horas / 7 dias
export const PERIODOS = [['1d', 'Hoje'], ['24h', '1D'], ['7d', '1S'], ['1mo', '1M'], ['3mo', '3M'], ['6mo', '6M'], ['1y', '1A'], ['2y', '2A'], ['5y', '5A'], ['max', 'Máx']]
export const TITULOS = { '1d': 'Hoje (último pregão)', '24h': 'Últimas 24 horas', '7d': 'Últimos 7 dias' }
// intervalo padrão por período (o Yahoo limita intraday a janelas curtas)
export const intervaloPadrao = (p) => (['1d', '24h'].includes(p) ? '5m' : ['5d', '7d'].includes(p) ? '30m' : p === '1mo' ? '1h' : ['5y', 'max'].includes(p) ? '1wk' : '1d')
// chave de alinhamento: dia para séries diárias; minuto em UTC para intraday (B3 vem em -03:00, cripto em UTC)
export const chaveIntraday = (d) => new Date(d).toISOString().slice(0, 16)

export function SeletorPeriodo({ periodo, onChange }) {
  return (
    <div className="seg">
      {PERIODOS.map(([p, l]) => <button key={p} className={p === periodo ? 'on' : ''} title={TITULOS[p]} onClick={() => onChange(p)}>{l}</button>)}
    </div>
  )
}

// alinha históricos de vários tickers numa grade de datas comum (união; buracos viram NaN)
export function alinhar(historicos, chaveData = (d) => d.slice(0, 10)) {
  const todas = new Set()
  historicos.forEach((h) => h.forEach((p) => todas.add(chaveData(p.data))))
  const datas = [...todas].sort()
  const idx = new Map(datas.map((d, i) => [d, i]))
  return { datas, idx }
}
