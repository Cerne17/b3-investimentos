import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, formatCol, signClass, signed } from '../format.js'
import { Scatter } from './Charts.jsx'

const GRUPOS_FII = [
  { label: 'Tijolo', color: 'var(--series-1)', match: (c) => c === 'Tijolo' },
  { label: 'Papel', color: 'var(--series-2)', match: (c) => c === 'Papel' },
  { label: 'FoF / Híbrido', color: 'var(--series-3)', match: (c) => c === 'FoF' || c === 'Híbrido' },
]

function Kpi({ label, value, hint }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Ranking({ titulo, itens, col, onOpen, tipo, format }) {
  return (
    <div className="card">
      <h2>{titulo}</h2>
      <table>
        <tbody>
          {itens.map((r, i) => (
            <tr key={r.codigo} onClick={() => onOpen(tipo, r.codigo)}>
              <td className="muted num" style={{ width: 24 }}>{i + 1}</td>
              <td style={{ whiteSpace: 'normal' }}><span className="tk">{r.ticker}</span> <span className="muted" style={{ fontSize: 12 }}>{r.categoria}</span></td>
              <td className={`num ${format ? '' : signClass(r[col])}`} style={{ fontWeight: 600 }}>{format ? format(r[col]) : formatCol(col, r[col])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Overview({ onOpen }) {
  const [res, setRes] = useState(null)
  const [scatter, setScatter] = useState([])
  const [rk, setRk] = useState({})
  const [erro, setErro] = useState(null)

  useEffect(() => {
    api.resumo().then(setRes).catch((e) => setErro(e.message))
    api.listar('fiis', { min_liquidez_media: 1000000, min_pvp: 0.3, max_pvp: 1.6, max_dividend_yield: 25, limite: 300 })
      .then((d) => setScatter(d.itens)).catch(() => {})
    const liq = { min_liquidez_media: 1000000 }
    Promise.all([
      api.ranking('fiis', 'dividend_yield', { n: 8, ...liq }),
      api.ranking('fiis', 'pvp', { n: 8, ordem: 'asc', min_pvp: 0.1, ...liq }),
      api.ranking('etfs', 'retorno_12m', { n: 8, min_liquidez_media: 500000 }),
      api.ranking('etfs', 'pl', { n: 8, ordem: 'asc', min_pl: 0.01, min_liquidez_media: 500000 }),
      api.ranking('acoes', 'dividend_yield', { n: 8, min_liquidez_media: 5000000 }),
      api.ranking('acoes', 'margem_graham', { n: 8, min_liquidez_media: 5000000, min_roe: 10 }),
    ]).then(([dy, pvp, r12, pl, adY, aGr]) => setRk({ dy, pvp, r12, pl, adY, aGr })).catch(() => {})
  }, [])

  if (erro) return <div className="alert">Não foi possível falar com a API: {erro}. O backend está rodando em :8000?</div>
  if (!res) return <div className="empty">Carregando…</div>
  const f = res.fundos, e = res.etfs, a = res.acoes

  return (
    <>
      <h1>Visão geral</h1>
      <p className="sub">
        {a.total} ações, {f.total} FIIs e {e.total} ETFs listados na B3 · {a.com_dados + f.com_dados + e.com_dados} com cotação ·
        atualizado em {fmt.date(f.ultima_atualizacao)}. Clique em qualquer ativo para ver detalhes e cotação ao vivo.
      </p>

      <div className="grid kpis">
        <Kpi label="DY mediano dos FIIs" value={fmt.pct(f.geral.dividend_yield?.mediana)} hint="últimos 12 meses" />
        <Kpi label="P/VP mediano dos FIIs" value={fmt.num(f.geral.pvp?.mediana)} hint={`${f.geral.pvp?.n || 0} fundos com VP`} />
        <Kpi label="Retorno total mediano FIIs" value={signed(f.geral.retorno_total_12m?.mediana)} hint="12m com proventos" />
        <Kpi label="P/L mediano dos ETFs" value={fmt.num(e.geral.pl?.mediana, 1)} hint={`${e.geral.pl?.n || 0} ETFs de ações`} />
        <Kpi label="Retorno mediano ETFs" value={signed(e.geral.retorno_12m?.mediana)} hint="12 meses" />
        <Kpi label="Volatilidade mediana ETFs" value={fmt.pct(e.geral.volatilidade_12m?.mediana)} hint="anualizada" />
        <Kpi label="P/L mediano das ações" value={fmt.num(a.geral.pl?.mediana, 1)} hint={`${a.geral.pl?.n || 0} com lucro`} />
        <Kpi label="ROE mediano das ações" value={fmt.pct(a.geral.roe?.mediana)} hint="retorno sobre patrimônio" />
        <Kpi label="DY mediano das ações" value={fmt.pct(a.geral.dividend_yield?.mediana)} hint="últimos 12 meses" />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>FIIs: dividend yield × P/VP</h2>
          <p className="muted" style={{ marginTop: -8, fontSize: 12 }}>
            Fundos com liquidez acima de R$ 1 mi/dia. À esquerda da linha tracejada (P/VP = 1) o fundo negocia abaixo do patrimônio.
          </p>
          <Scatter data={scatter} x="pvp" y="dividend_yield" group="categoria" groups={GRUPOS_FII}
            xLabel="P/VP" yLabel="DY 12m (%)" onPick={(d) => onOpen('fiis', d.codigo)} />
        </div>
        <div className="card">
          <h2>FIIs por categoria</h2>
          <table>
            <thead><tr><th className="txt">Categoria</th><th>Qtd</th><th>DY med.</th><th>P/VP med.</th><th>Ret. total</th></tr></thead>
            <tbody>
              {Object.entries(f.por_categoria).map(([cat, s]) => (
                <tr key={cat} style={{ cursor: 'default' }}>
                  <td className="txt">{cat}</td><td className="num">{s.quantidade}</td>
                  <td className="num">{fmt.pct(s.dividend_yield?.mediana)}</td>
                  <td className="num">{fmt.num(s.pvp?.mediana)}</td>
                  <td className={`num ${signClass(s.retorno_total_12m?.mediana)}`}>{signed(s.retorno_total_12m?.mediana)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 20 }}>ETFs por categoria</h2>
          <table>
            <thead><tr><th className="txt">Categoria</th><th>Qtd</th><th>Ret. 12m</th><th>Volat.</th><th>P/L</th></tr></thead>
            <tbody>
              {Object.entries(e.por_categoria).map(([cat, s]) => (
                <tr key={cat} style={{ cursor: 'default' }}>
                  <td className="txt">{cat}</td><td className="num">{s.quantidade}</td>
                  <td className={`num ${signClass(s.retorno_12m?.mediana)}`}>{signed(s.retorno_12m?.mediana)}</td>
                  <td className="num">{fmt.pct(s.volatilidade_12m?.mediana)}</td>
                  <td className="num">{fmt.num(s.pl?.mediana, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid kpis" style={{ marginTop: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {rk.dy && <Ranking titulo="Maior DY · FIIs líquidos" itens={rk.dy} col="dividend_yield" tipo="fiis" onOpen={onOpen} format={fmt.pct} />}
        {rk.pvp && <Ranking titulo="Menor P/VP · FIIs líquidos" itens={rk.pvp} col="pvp" tipo="fiis" onOpen={onOpen} format={(v) => fmt.num(v)} />}
        {rk.r12 && <Ranking titulo="Melhor retorno 12m · ETFs" itens={rk.r12} col="retorno_12m" tipo="etfs" onOpen={onOpen} />}
        {rk.pl && <Ranking titulo="Menor P/L · ETFs" itens={rk.pl} col="pl" tipo="etfs" onOpen={onOpen} format={(v) => fmt.num(v, 1)} />}
        {rk.adY && <Ranking titulo="Maior DY · ações líquidas" itens={rk.adY} col="dividend_yield" tipo="acoes" onOpen={onOpen} format={fmt.pct} />}
        {rk.aGr && <Ranking titulo="Maior margem de Graham · ROE > 10%" itens={rk.aGr} col="margem_graham" tipo="acoes" onOpen={onOpen} />}
      </div>
    </>
  )
}
