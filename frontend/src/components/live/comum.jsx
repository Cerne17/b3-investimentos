import React from 'react'

export const CORES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
export const cor = (i) => CORES[i % CORES.length]

export const PERIODOS = [['5d', '5D'], ['1mo', '1M'], ['3mo', '3M'], ['6mo', '6M'], ['1y', '1A'], ['2y', '2A'], ['5y', '5A'], ['max', 'Máx']]
// intervalo padrão por período (o Yahoo limita intraday a janelas curtas)
export const intervaloPadrao = (p) => (p === '5d' ? '15m' : p === '1mo' ? '1h' : ['5y', 'max'].includes(p) ? '1wk' : '1d')

export function SeletorPeriodo({ periodo, onChange }) {
  return (
    <div className="seg">
      {PERIODOS.map(([p, l]) => <button key={p} className={p === periodo ? 'on' : ''} onClick={() => onChange(p)}>{l}</button>)}
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
