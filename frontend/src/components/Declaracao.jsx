import React, { useState } from 'react'
import { fmt } from '../format.js'

const csv = (linhas) => linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')

// Apoio à declaração anual do IR: bens e direitos em 31/12, rendimentos do ano e renda variável mês a mês.
export default function Declaracao({ irpf }) {
  const anos = Object.keys(irpf || {}).sort().reverse()
  const [ano, setAno] = useState(null)
  const [copiado, setCopiado] = useState(null)
  if (!anos.length) return null
  const a = ano && irpf[ano] ? ano : (anos.find((x) => !irpf[x].em_curso) || anos[0])
  const d = irpf[a]
  const copiar = (texto, id) => navigator.clipboard?.writeText(texto).then(() => { setCopiado(id); setTimeout(() => setCopiado(null), 1500) })
  const baixar = () => {
    const linhas = [['Bens e direitos', a], ['Grupo', 'Código', 'Ativo', 'Quantidade', `Situação em 31/12/${a - 1}`, `Situação em 31/12/${a}`, 'Discriminação'],
      ...d.bens.map((b) => [b.grupo, b.codigo, b.ticker, b.quantidade, b.situacao_anterior.toFixed(2).replace('.', ','), b.situacao_atual.toFixed(2).replace('.', ','), b.discriminacao]),
      [], ['Rendimentos', a], ['Tipo', 'Ativo', 'Valor'], ...d.rendimentos.map((r) => [r.tipo, r.ticker, r.valor.toFixed(2).replace('.', ',')]),
      [], ['Renda variável', a], ['Mês', 'Lucro isento', 'Imposto', 'DARF'], ...d.renda_variavel.map((m) => [m.mes, m.isento, m.imposto, m.darf])]
    const el = document.createElement('a')
    el.href = URL.createObjectURL(new Blob(['﻿' + csv(linhas)], { type: 'text/csv;charset=utf-8' }))
    el.download = `irpf-${a}.csv`
    el.click()
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Declaração anual do IR</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={a} onChange={(e) => setAno(e.target.value)} aria-label="Ano-calendário">
            {anos.map((x) => <option key={x} value={x}>Ano-calendário {x}{irpf[x].em_curso ? ' (em curso)' : ''}</option>)}
          </select>
          <button className="btn" onClick={baixar}>Baixar CSV</button>
        </div>
      </div>
      {d.em_curso && <p className="muted" style={{ fontSize: 12 }}>Ano em curso: a situação em 31/12 é a posição de hoje e pode mudar até o fim do ano.</p>}
      <div className="grid kpis compacto" style={{ margin: '10px 0' }}>
        <div className="card kpi"><div className="label">Bens em 31/12/{a}</div><div className="value num">{fmt.brl(d.totais.bens_atual)}</div><div className="hint">custo de aquisição · {a - 1}: {fmt.brl(d.totais.bens_anterior)}</div></div>
        <div className="card kpi"><div className="label">Rendimentos isentos</div><div className="value num">{fmt.brl(d.totais.rendimentos_isentos + d.totais.lucro_isento_acoes)}</div><div className="hint">proventos {fmt.brl(d.totais.rendimentos_isentos)} · vendas de ações até 20 mil {fmt.brl(d.totais.lucro_isento_acoes)}</div></div>
        <div className="card kpi"><div className="label">Tributação exclusiva</div><div className="value num">{fmt.brl(d.totais.tributacao_exclusiva)}</div><div className="hint">cupons do Tesouro (IR já retido)</div></div>
        <div className="card kpi"><div className="label">DARFs de renda variável</div><div className="value num">{fmt.brl(d.totais.darf)}</div><div className="hint">{d.renda_variavel.length} meses com vendas</div></div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 6 }}>Bens e direitos</div>
      <div className="table-wrap cartoes" style={{ border: 0 }}>
        <table>
          <thead><tr><th className="txt">Ativo</th><th className="txt">Grupo-código</th><th>31/12/{a - 1}</th><th>31/12/{a}</th><th className="txt">Discriminação</th><th aria-label="Copiar" /></tr></thead>
          <tbody>
            {d.bens.map((b) => (
              <tr key={b.ticker} style={{ cursor: 'default' }}>
                <td className="txt"><b>{b.ticker}</b> <span className="muted">{b.classe}</span></td>
                <td className="txt" title={b.descricao_codigo}>{b.grupo}-{b.codigo}</td>
                <td className="num">{fmt.brl(b.situacao_anterior)}</td>
                <td className="num">{fmt.brl(b.situacao_atual)}</td>
                <td className="txt" style={{ whiteSpace: 'normal', minWidth: 240, fontSize: 12 }}>{b.discriminacao}</td>
                <td><button className="chip" onClick={() => copiar(b.discriminacao, b.ticker)}>{copiado === b.ticker ? 'Copiado' : 'Copiar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.rendimentos.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Rendimentos recebidos em {a}</div>
          <div className="table-wrap cartoes" style={{ border: 0 }}>
            <table>
              <thead><tr><th className="txt">Ficha</th><th className="txt">Ativo</th><th>Valor</th></tr></thead>
              <tbody>
                {d.rendimentos.map((r) => (
                  <tr key={r.tipo + r.ticker} style={{ cursor: 'default' }}>
                    <td className="txt" style={{ whiteSpace: 'normal', fontSize: 12 }}>{r.tipo}</td><td className="txt">{r.ticker}</td><td className="num">{fmt.brl(r.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Situação em 31/12 = custo de aquisição pelo custo médio (não o valor de mercado), com a quantidade da época. Proventos pela data ex e brutos;
        JCP não é separado dos dividendos. Os grupos/códigos são sugestões: confira no programa da Receita e use os informes de rendimentos
        da corretora e das fontes pagadoras, que prevalecem. Ganhos isentos de ações até R$ 20 mil/mês vão em Rendimentos Isentos; os meses
        tributados, em Renda Variável.
      </p>
    </div>
  )
}
