import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, signClass, signed } from '../format.js'
import { MultiLineChart } from './Charts.jsx'

const CORES_B = { IBOV: 'var(--series-2)', CDI: 'var(--series-3)', IFIX: 'var(--series-4)', 'S&P 500': 'var(--series-5)' }

function Kpi({ label, value, sub, className = '' }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value num ${className}`}>{value}</div>
      {sub && <div className="hint">{sub}</div>}
    </div>
  )
}

// Busca o desempenho real das operações (com debounce): usado pelo painel e pelas posições ajustadas.
export function useDesempenho(transacoes) {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState(null)
  const chave = JSON.stringify(transacoes.map((t) => [t.data, t.ticker, t.tipo, t.quantidade, t.preco, t.evento]))
  useEffect(() => {
    if (!transacoes.length) { setD(null); return }
    let vivo = true
    setErro(null)
    const t = setTimeout(() => {
      api.desempenho({ transacoes: transacoes.map(({ data, ticker, tipo, quantidade, preco, evento }) => ({ data, ticker, tipo, quantidade, preco, evento: evento || null })) })
        .then((r) => vivo && setD(r)).catch((e) => vivo && setErro(e.message))
    }, 400)
    return () => { vivo = false; clearTimeout(t) }
  }, [chave])
  return [d, erro]
}

// Apuração mensal do IR sobre vendas (DARF), a partir das operações.
export function ImpostoVendas({ d }) {
  const meses = d?.ir?.meses || []
  if (!meses.length) return null
  const comImposto = meses.filter((m) => m.imposto > 0 || m.darf > 0).length
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Imposto de renda sobre vendas</h2>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        {comImposto ? <>DARF no período: <b className="num">{fmt.brl(d.ir.total_darf)}</b></> : 'Nenhum mês com imposto a pagar'}
        {d.ir.a_pagar_acumulado > 0 && <> · {fmt.brl(d.ir.a_pagar_acumulado)} acumulado (abaixo de R$ 10, vai para o próximo DARF)</>}
      </div>
      <div className="table-wrap cartoes" style={{ border: 0 }}>
        <table>
          <thead><tr><th className="txt">Mês</th><th className="txt">Vendas</th><th className="txt">Lucro</th><th>Isento</th><th>Imposto</th><th>DARF</th><th className="txt">Prejuízo a compensar</th></tr></thead>
          <tbody>
            {[...meses].reverse().map((m) => (
              <tr key={m.mes} style={{ cursor: 'default' }}>
                <td className="txt" data-label="Mês">{m.mes.slice(5)}/{m.mes.slice(0, 4)}</td>
                <td className="txt" data-label="Vendas">{Object.entries(m.vendas).map(([c, v]) => `${c} ${fmt.brl(v)}`).join(' · ')}</td>
                <td className="txt" data-label="Lucro">{Object.entries(m.lucro).map(([c, v]) => <span key={c} className={signClass(v)}>{c} {fmt.brl(v)} </span>)}</td>
                <td className="num" data-label="Isento">{m.isento ? fmt.brl(m.isento) : '—'}</td>
                <td className="num" data-label="Imposto">{m.imposto ? fmt.brl(m.imposto) : '—'}</td>
                <td className="num" data-label="DARF"><b>{m.darf ? fmt.brl(m.darf) : '—'}</b></td>
                <td className="txt" data-label="Prejuízo">{[['comum', 'Ações/ETFs'], ['fii', 'FIIs'], ['cripto', 'Cripto']].filter(([k]) => m.prejuizo_acumulado[k] > 0)
                  .map(([k, l]) => `${l} ${fmt.brl(m.prejuizo_acumulado[k])}`).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Operações comuns de pessoa física, pelo custo médio: ações isentas se as vendas de ações do mês somam até R$ 20 mil; ETFs e BDRs 15%
        sem isenção; FIIs 20%; cripto 15% com isenção até R$ 35 mil/mês. Prejuízo compensa lucro futuro da mesma categoria. Day trade,
        renda fixa e Tesouro (IR retido na fonte) não entram. Confira com seu contador — é uma estimativa.
      </p>
    </div>
  )
}

// Desempenho real a partir das operações: TWR x índices, TIR, lucro e proventos recebidos.
export default function Desempenho({ transacoes, d, erro }) {
  const [vista, setVista] = useState('rentabilidade')
  const [bench, setBench] = useState('CDI')

  if (!transacoes.length) return null
  const t = d?.totais
  const benchs = d ? Object.entries(d.benchmarks) : []
  const resultadoTotal = t ? t.valor + t.proventos : 0

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Desempenho real{d ? ` · desde ${fmt.date(d.inicio)}` : ''}</h2>
        <div className="seg">
          <button className={vista === 'rentabilidade' ? 'on' : ''} onClick={() => setVista('rentabilidade')}>Rentabilidade x índices</button>
          <button className={vista === 'patrimonio' ? 'on' : ''} onClick={() => setVista('patrimonio')}>Patrimônio x aportes</button>
        </div>
      </div>
      {erro && <div className="alert section">{erro}</div>}
      {!d && !erro && <div className="empty">Calculando com o histórico de cada ativo…</div>}
      {d && (
        <>
          <div className="grid kpis compacto" style={{ margin: '12px 0' }}>
            <Kpi label="Lucro total" value={`${t.lucro >= 0 ? '+' : ''}${fmt.brl(t.lucro)}`} className={signClass(t.lucro)}
              sub={`valor ${fmt.brl(t.valor)} + vendas ${fmt.brl(t.vendas)} + proventos ${fmt.brl(t.proventos)} − compras ${fmt.brl(t.compras)}`} />
            <Kpi label="Rentabilidade (TWR)" value={signed(t.twr)} className={signClass(t.twr)}
              sub={t.twr_anual != null ? `${signed(t.twr_anual)} ao ano · sem efeito dos aportes` : 'sem efeito dos aportes e vendas'} />
            <Kpi label="TIR (seu dinheiro)" value={t.tir_anual != null ? `${signed(t.tir_anual)} a.a.` : '—'} className={signClass(t.tir_anual)}
              sub="considera quando cada real entrou e saiu" />
            <Kpi label="Proventos recebidos" value={fmt.brl(t.proventos)} sub={`${d.proventos_recebidos.length} pagamentos na data ex`} />
          </div>

          {vista === 'rentabilidade' ? (
            <MultiLineChart datas={d.datas} label="Rentabilidade acumulada da carteira e dos índices" fmtY={(v) => signed(v)} height={260}
              series={[{ nome: 'Carteira', valores: d.twr, cor: 'var(--series-1)' },
                ...benchs.map(([n, b]) => ({ nome: n, valores: b.twr, cor: CORES_B[n] || 'var(--text-muted)', tracejado: true }))]} />
          ) : (
            <>
              <div className="filters" style={{ margin: '0 0 6px' }}>
                <label className="field">Comparar com os mesmos aportes em
                  <select value={bench} onChange={(e) => setBench(e.target.value)}>{benchs.map(([n]) => <option key={n}>{n}</option>)}</select>
                </label>
              </div>
              <MultiLineChart datas={d.datas} label="Patrimônio, total investido e o mesmo dinheiro aplicado no índice" fmtY={(v) => fmt.brl(v)} height={260}
                series={[
                  { nome: 'Carteira + proventos', valores: d.valor.map((v, i) => v + d.proventos[i]), cor: 'var(--series-1)' },
                  { nome: 'Investido líquido', valores: d.investido, cor: 'var(--text-muted)', tracejado: true },
                  ...(d.benchmarks[bench] ? [{ nome: `Mesmos aportes em ${bench}`, valores: d.benchmarks[bench].mesmos_aportes, cor: CORES_B[bench], tracejado: true }] : []),
                ]} />
            </>
          )}

          <div className="table-wrap" style={{ border: 0, marginTop: 10 }}>
            <table>
              <thead><tr><th className="txt">Comparação</th><th>No período</th><th title="Valor de hoje se cada compra e venda tivesse sido feita no índice">Mesmos aportes</th><th>Diferença</th></tr></thead>
              <tbody>
                <tr style={{ cursor: 'default' }}><td className="txt"><b>Sua carteira</b> (com proventos)</td><td className={`num ${signClass(t.twr)}`}>{signed(t.twr)}</td><td className="num">{fmt.brl(resultadoTotal)}</td><td /></tr>
                {benchs.map(([n, b]) => {
                  const dif = resultadoTotal - b.valor_final_mesmos_aportes
                  return (
                    <tr key={n} style={{ cursor: 'default' }}>
                      <td className="txt"><span className="dot" style={{ background: CORES_B[n] }} />{n}{b.simbolo !== n ? <span className="muted"> ({b.simbolo})</span> : ''}</td>
                      <td className={`num ${signClass(b.retorno)}`}>{signed(b.retorno)}</td>
                      <td className="num">{fmt.brl(b.valor_final_mesmos_aportes)}</td>
                      <td className={`num ${signClass(dif)}`}>{dif >= 0 ? '+' : ''}{fmt.brl(dif)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {d.proventos_recebidos.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Proventos recebidos ({d.proventos_recebidos.length})</summary>
              <div className="table-wrap" style={{ border: 0 }}>
                <table>
                  <thead><tr><th className="txt">Data ex</th><th className="txt">Ativo</th><th>R$/cota</th><th>Cotas</th><th>Valor</th></tr></thead>
                  <tbody>
                    {d.proventos_recebidos.map((p, i) => (
                      <tr key={i} style={{ cursor: 'default' }}>
                        <td className="txt">{fmt.date(p.data)}</td><td className="txt">{p.ticker}</td>
                        <td className="num">{fmt.num(p.por_cota, 4)}</td><td className="num">{fmt.num(p.quantidade, p.quantidade % 1 ? 4 : 0)}</td>
                        <td className="num">{fmt.brl(p.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {d.avisos.length > 0 && <p className="muted" style={{ fontSize: 12 }}>{d.avisos.join(' · ')}</p>}
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            TWR = rentabilidade da carteira sem o efeito de quando você aportou (é a que se compara com índices). TIR = rentabilidade anual do seu
            dinheiro. Proventos brutos, contados na data ex. IFIX via XFIX11 e S&P 500 via IVVB11 (em reais), com proventos reinvestidos.
          </p>
        </>
      )}
    </div>
  )
}
