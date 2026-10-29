import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fmt, signClass, signed } from '../format.js'
import { MultiLineChart } from './Charts.jsx'

const CLASSES = { ACAO: 'Ações', FII: 'FIIs', ETF: 'ETFs', CRIPTO: 'Cripto', RF: 'Renda fixa' }

// Relatório da carteira para imprimir ou salvar como PDF (impressão do navegador).
export default function Relatorio({ carteira, linhas, tot, desemp, agenda, onFechar }) {
  useEffect(() => {
    document.body.classList.add('imprimindo')
    const t = setTimeout(() => window.print(), 400)
    const fim = () => onFechar()
    window.addEventListener('afterprint', fim)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', fim); document.body.classList.remove('imprimindo') }
  }, [])

  const t = desemp?.totais
  const classes = {}
  linhas.forEach((l) => { const c = CLASSES[l.tipo] || 'Outros'; classes[c] = (classes[c] || 0) + (l.valor || 0) })
  const hoje = new Date().toLocaleDateString('pt-BR')
  // fora do #root (portal no body): na impressão o app inteiro some e só a folha fica
  return createPortal(
    <div className="relatorio" role="dialog" aria-label="Relatório da carteira">
      <div className="relatorio-acoes">
        <button className="btn primary" onClick={() => window.print()}>Imprimir / salvar PDF</button>
        <button className="btn" onClick={onFechar}>Fechar</button>
      </div>
      <header>
        <div className="muted">B3 · cerne.pro — relatório de carteira</div>
        <h1 style={{ margin: '4px 0' }}>{carteira.nome}</h1>
        <div className="muted">Gerado em {hoje}{desemp ? ` · operações desde ${fmt.date(desemp.inicio)}` : ''}</div>
      </header>

      <section className="relatorio-kpis">
        <div><span>Patrimônio</span><b>{fmt.brl(tot.valor)}</b></div>
        <div><span>Resultado (preço)</span><b className={signClass(tot.resultado)}>{fmt.brl(tot.resultado)} ({signed(tot.resultadoPct)})</b></div>
        {t && <div><span>Lucro total</span><b className={signClass(t.lucro)}>{fmt.brl(t.lucro)}</b></div>}
        {t && <div><span>Rentabilidade (TWR)</span><b>{signed(t.twr)}{t.twr_anual != null ? ` · ${signed(t.twr_anual)} a.a.` : ''}</b></div>}
        {t?.tir_anual != null && <div><span>TIR</span><b>{signed(t.tir_anual)} a.a.</b></div>}
        {t && <div><span>Proventos recebidos</span><b>{fmt.brl(t.proventos)}</b></div>}
        <div><span>Renda estimada</span><b>{fmt.brl(tot.renda)}/mês</b></div>
        {agenda && <div><span>Proventos próximos 12 meses</span><b>{fmt.brl(agenda.total_12m)}</b></div>}
      </section>

      {desemp && (
        <section>
          <h2>Rentabilidade x índices</h2>
          <MultiLineChart datas={desemp.datas} label="Rentabilidade acumulada" fmtY={(v) => signed(v)} height={220}
            series={[{ nome: 'Carteira', valores: desemp.twr, cor: '#E89A3C' },
              ...Object.entries(desemp.benchmarks).map(([n, b], i) => ({ nome: n, valores: b.twr, cor: ['#6B8AFD', '#3FB68B', '#B57EDC', '#9AA0A6'][i % 4], tracejado: true }))]} />
          <table>
            <thead><tr><th className="txt">Comparação</th><th>No período</th><th>Mesmos aportes</th></tr></thead>
            <tbody>
              <tr><td className="txt">Sua carteira (com proventos)</td><td className="num">{signed(t.twr)}</td><td className="num">{fmt.brl(t.valor + t.proventos)}</td></tr>
              {Object.entries(desemp.benchmarks).map(([n, b]) => (
                <tr key={n}><td className="txt">{n}</td><td className="num">{signed(b.retorno)}</td><td className="num">{fmt.brl(b.valor_final_mesmos_aportes)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Posições</h2>
        <table>
          <thead><tr><th className="txt">Ativo</th><th className="txt">Classe</th><th>Qtd.</th><th>Preço médio</th><th>Preço</th><th>Valor</th><th>Peso</th><th>Resultado</th><th>Renda/mês</th></tr></thead>
          <tbody>
            {[...linhas].sort((a, b) => (b.valor || 0) - (a.valor || 0)).map((l) => (
              <tr key={l.ticker}>
                <td className="txt">{l.ticker}</td><td className="txt">{CLASSES[l.tipo] || '—'}</td>
                <td className="num">{fmt.num(l.quantidade, Number.isInteger(l.quantidade) ? 0 : 4)}</td>
                <td className="num">{fmt.preco(l.preco_medio)}</td><td className="num">{l.preco != null ? fmt.preco(l.preco) : '—'}</td>
                <td className="num">{fmt.brl(l.valor)}</td><td className="num">{tot.valor ? fmt.pct(((l.valor || 0) / tot.valor) * 100, 1) : '—'}</td>
                <td className={`num ${signClass(l.resultado)}`}>{l.resultado != null ? `${fmt.brl(l.resultado)} (${signed(l.resultado_pct)})` : '—'}</td>
                <td className="num">{l.renda_mes ? fmt.brl(l.renda_mes) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="relatorio-duas">
        <div>
          <h2>Alocação por classe</h2>
          <table><tbody>
            {Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
              <tr key={c}><td className="txt">{c}</td><td className="num">{fmt.brl(v)}</td><td className="num">{fmt.pct(tot.valor ? (v / tot.valor) * 100 : 0, 1)}</td></tr>
            ))}
          </tbody></table>
        </div>
        {agenda && (
          <div>
            <h2>Proventos estimados por mês</h2>
            <table><tbody>
              {agenda.meses.filter((m) => m.total > 0).map((m) => (
                <tr key={m.mes}><td className="txt">{m.mes.slice(5)}/{m.mes.slice(0, 4)}</td><td className="num">{fmt.brl(m.total)}</td><td className="txt muted">{m.itens.map((i) => i.ticker).join(', ')}</td></tr>
              ))}
            </tbody></table>
          </div>
        )}
      </section>

      <footer className="muted">
        Valores de mercado do Yahoo Finance, Banco Central e Tesouro Transparente na data de geração; proventos brutos pela data ex; renda
        futura estimada pela regularidade dos pagamentos. Material informativo — não é recomendação de investimento.
      </footer>
    </div>,
    document.body,
  )
}
