import React, { useEffect, useState } from 'react'

export const CHAVE_GUIA = 'guia_v1'

const PASSOS = [
  { titulo: 'Traga sua carteira', aba: 'broker', botao: 'Abrir o Home Broker',
    texto: 'Na Área do Investidor da B3 (investidor.b3.com.br), exporte o extrato de Negociação ou de Movimentação em Excel e use Importar no Home Broker. As compras entram com data e preço reais; o que não está na B3 (cripto, CDB de outro lugar) você lança em Operações.' },
  { titulo: 'Veja o que aconteceu de verdade', aba: 'broker', botao: 'Ver desempenho',
    texto: 'Com as operações, o Home Broker mostra lucro, rentabilidade contra IBOV, CDI e IFIX, proventos recebidos, a agenda dos próximos e o IR: DARF mês a mês e o apoio à declaração anual. Relatório PDF e link compartilhável ficam no topo.' },
  { titulo: 'Decida o próximo aporte', aba: 'carteira', botao: 'Abrir o Markowitz',
    texto: 'No Markowitz, importe a carteira do Home Broker, escolha os ativos candidatos e veja carteiras otimizadas ao lado da sua. Informe o aporte do mês para saber quantas cotas comprar de cada um, sem vender nada.' },
  { titulo: 'Simule o futuro', aba: 'montecarlo', botao: 'Abrir o Monte Carlo',
    texto: 'Milhares de cenários a partir do comportamento real dos ativos: patrimônio, meta de renda, aposentadoria (quanto dá para sacar com segurança) e a chance de bater o Ibovespa. Com IR e inflação, se quiser.' },
  { titulo: 'Pesquise antes de comprar', aba: 'comparafiis', botao: 'Comparar FIIs',
    texto: 'Ações, FIIs, ETFs e cripto têm telas de filtro em Mercado; Comparar FIIs põe até 6 fundos lado a lado com P/VP, DY, vacância e o histórico. Renda fixa: busque “CDI”, “IPCA+6” ou “tesouro ipca”.' },
]

// Primeiro acesso: um passo a passo curto que leva a cada parte do app. Reabre pelo botão "Guia" do topo.
export default function Guia({ onIr, onFechar }) {
  const [i, setI] = useState(0)
  const p = PASSOS[i]
  const fechar = () => { try { localStorage.setItem(CHAVE_GUIA, '1') } catch {} onFechar() }
  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && fechar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])
  return (
    <div className="guia-fundo" onClick={fechar}>
      <div className="card guia" role="dialog" aria-modal="true" aria-label="Primeiros passos" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Primeiros passos · {i + 1} de {PASSOS.length}</div>
        <h2 style={{ margin: '6px 0 8px' }}>{p.titulo}</h2>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{p.texto}</p>
        <div className="guia-pontos" aria-hidden="true">{PASSOS.map((_, k) => <i key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} />)}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <button className="btn" onClick={fechar}>Pular</button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { fechar(); onIr(p.aba) }}>{p.botao}</button>
            {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Voltar</button>}
            {i < PASSOS.length - 1
              ? <button className="btn primary" onClick={() => setI(i + 1)}>Próximo</button>
              : <button className="btn primary" onClick={fechar}>Começar</button>}
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
          Dica: no celular, “Adicionar à tela inicial” instala o app. Suas carteiras ficam só neste navegador.
        </p>
      </div>
    </div>
  )
}
