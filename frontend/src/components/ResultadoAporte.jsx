import React from 'react'
import { fmt, signClass } from '../format.js'

const qtd = (x) => (x.fracionario ? fmt.num(Math.abs(x.comprar), Math.abs(x.comprar) < 1 ? 6 : 2) : Math.abs(x.comprar))
const MODO = { nao_comprar: 'não comprar', manter: 'manter' }

// Tabela de operações sugeridas por /api/carteira/aporte: compras e (com vendas permitidas) vendas.
export default function ResultadoAporte({ r }) {
  return (
    <>
      <div className="cartoes"><table>
        <thead><tr><th className="txt">Ativo</th><th title="Peso hoje">Hoje</th><th>Alvo</th><th className="txt">Operação</th><th>Valor</th><th title="Peso depois">Depois</th>
          {r.lucro_vendas != null && <th title="Lucro da venda pelo preço médio">Lucro</th>}</tr></thead>
        <tbody>
          {r.ativos.map((x) => (
            <tr key={x.ticker} style={{ cursor: 'default', opacity: x.operacao ? 1 : 0.6 }}>
              <td className="txt">{x.ticker}{x.congelado ? <span className="badge" style={{ marginLeft: 6 }}>❄ {MODO[x.congelado]}</span> : ''}</td>
              <td className="num">{fmt.pct(x.peso_atual, 1)}</td>
              <td className="num">{fmt.pct(x.peso_alvo, 1)}</td>
              <td className="txt">{x.operacao ? <b className={x.operacao === 'venda' ? 'neg' : 'pos'}>{x.operacao === 'venda' ? 'Vender' : 'Comprar'} {qtd(x)}</b> : '—'}</td>
              <td className="num">{fmt.brl(Math.abs(x.valor_compra))}</td>
              <td className="num">{fmt.pct(x.peso_depois, 1)}</td>
              {r.lucro_vendas != null && <td className={`num ${signClass(x.lucro_venda)}`}>{x.lucro_venda != null ? fmt.brl(x.lucro_venda) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Compras {fmt.brl(r.compras)}{r.vendas > 0 ? ` · vendas ${fmt.brl(r.vendas)}` : ''}{r.sobra > 0.01 ? ` · sobram ${fmt.brl(r.sobra)}` : ''}
        {r.lucro_vendas ? ` · lucro nas vendas ${fmt.brl(r.lucro_vendas)} (pode gerar IR: veja a isenção de R$ 20 mil/mês em ações)` : ''}
        {' '}· fora do alvo: {r.fora_do_alvo_antes != null ? `${fmt.pct(r.fora_do_alvo_antes, 1)} → ` : ''}{fmt.pct(r.fora_do_alvo_depois, 1)} da carteira.
      </div>
    </>
  )
}
