import React, { useState } from 'react'
import { api } from '../api.js'

const ORIGEM = typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':8000') : 'http://localhost:8000'

const ENDPOINTS = [
  ['GET', '/api/acoes', 'Lista/filtra ações — ?categoria=Bancos&max_pl=8&min_roe=15&segmento=Novo Mercado'],
  ['GET', '/api/acoes/{codigo}', 'Fundamentos completos de uma ação (PETR4, TAEE11)'],
  ['GET', '/api/fiis', 'Lista/filtra FIIs — ?segmento=Logística&max_pvp=0.95&min_dividend_yield=9'],
  ['GET', '/api/fiis/{codigo}', 'Todas as métricas de um FII + proventos recentes'],
  ['GET', '/api/etfs', 'Lista/filtra ETFs — ?categoria=Internacional&max_volatilidade_12m=20'],
  ['GET', '/api/etfs/{codigo}', 'Todas as métricas de um ETF'],
  ['GET', '/api/criptos', 'Lista/filtra criptos (em R$) — ?max_rank_mercado=20&excluir_categoria=Stablecoin'],
  ['GET', '/api/criptos/{codigo}', 'Métricas de uma cripto (BTC, BTC-BRL)'],
  ['GET', '/api/ranking/{tipo}/{metrica}', 'Top N — /api/ranking/fiis/pvp?ordem=asc&min_liquidez_media=1000000'],
  ['GET', '/api/comparar', 'Lado a lado — ?codigos=HGLG11,BTLG11,XPLG11'],
  ['GET', '/api/resumo', 'Estatísticas por categoria'],
  ['GET', '/api/metricas', 'Dicionário de todas as colunas'],
  ['GET', '/api/proventos/{codigo}', 'Histórico de proventos'],
  ['POST', '/api/sql', 'SELECT livre (somente leitura) nas tabelas acoes, etfs, fundos, criptos, proventos e view ativos'],
  ['POST', '/api/carteira/otimizar', 'Markowitz: Sharpe, Sortino, Calmar, CVaR, paridade de risco… estimativas robustas, IR + cotas inteiras'],
  ['POST', '/api/carteira/aporte', 'Onde aportar: cotas a comprar para chegar perto dos pesos-alvo, sem vender'],
  ['POST', '/api/carteira/desempenho', 'Desempenho real das operações: TWR, TIR, proventos recebidos x IBOV, CDI, IFIX'],
  ['POST', '/api/carteira/importar-b3', 'Extrato da Área do Investidor da B3 (xlsx/csv) → operações'],
  ['GET', '/api/carteira/opcoes', 'Indicadores e filosofias de investimento'],
  ['POST', '/api/montecarlo/carteira', 'Monte Carlo do patrimônio: aportes, aposentadoria, proventos, IR, meta e benchmark simulado'],
  ['POST', '/api/montecarlo/ativo', 'Cone de preço: percentis, chance de alta, de tocar alvos, VaR'],
  ['GET', '/api/busca', 'Autocomplete de ações, ETFs, FIIs, criptos e renda fixa — ?q=ipca'],
  ['GET', '/api/tempo-real/cotacao/{ticker}', 'Cotação ao vivo (Yahoo)'],
  ['GET', '/api/tempo-real/preco/{ticker}', 'Preço como negociado numa data — ?data=2025-03-14 (renda fixa: índice)'],
  ['GET', '/api/tempo-real/proventos', 'Proventos dos últimos 12 meses — ?tickers=MXRF11,PETR4'],
  ['GET', '/api/tempo-real/cotacoes', 'Várias cotações — ?tickers=HGLG11,BOVA11'],
  ['GET', '/api/tempo-real/historico/{ticker}', 'OHLCV — ?periodo=1y&intervalo=1d'],
  ['POST', '/api/atualizar/{tipo}/{codigo}', 'Recoleta um ativo e grava no banco'],
]

const EXEMPLO_SQL = `SELECT segmento, COUNT(*) AS fundos,
       ROUND(AVG(dividend_yield), 2) AS dy_medio,
       ROUND(AVG(pvp), 2) AS pvp_medio
FROM fundos
WHERE status = 'ok' AND liquidez_media > 500000
GROUP BY segmento
ORDER BY dy_medio DESC`

export default function Docs() {
  const [q, setQ] = useState(EXEMPLO_SQL)
  const [res, setRes] = useState(null)
  const [erro, setErro] = useState(null)
  const rodar = () => { setErro(null); api.sql(q).then(setRes).catch((e) => { setRes(null); setErro(e.message) }) }

  const mcpCfg = `{
  "mcpServers": {
    "b3-fundos": {
      "command": "<pasta-do-projeto>/backend/.venv/bin/python",
      "args": ["<pasta-do-projeto>/backend/run_mcp.py"]
    }
  }
}`

  return (
    <>
      <h1>API, Postman e MCP</h1>
      <p className="sub">Tudo que o dashboard mostra vem desta API — você pode consumir os mesmos dados no Postman, em scripts ou por uma IA via MCP.</p>

      <div className="grid two">
        <div className="card">
          <h2>Endpoints principais</h2>
          {ENDPOINTS.map(([m, p, d]) => (
            <div className="endpoint" key={m + p}><span className="method">{m}</span><div><code>{p}</code><div className="muted" style={{ fontSize: 12 }}>{d}</div></div></div>
          ))}
          <p className="muted" style={{ fontSize: 13 }}>
            Toda coluna numérica aceita <code>min_&lt;coluna&gt;</code> e <code>max_&lt;coluna&gt;</code>; ordene com <code>ordenar</code> e <code>ordem=asc|desc</code>.
          </p>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>Swagger</h2>
            <p>Documentação interativa: <a href={`${ORIGEM}/docs`} target="_blank" rel="noreferrer">{ORIGEM}/docs</a> · <a href={`${ORIGEM}/redoc`} target="_blank" rel="noreferrer">ReDoc</a></p>
            <h2>Postman</h2>
            <p style={{ marginBottom: 0 }}>Import → Link → cole <code>{ORIGEM}/openapi.json</code>. O Postman cria a coleção com todos os endpoints e parâmetros.</p>
          </div>
          <div className="card">
            <h2>MCP (Claude Desktop, Claude Code, Cursor…)</h2>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Ferramentas: buscar_acoes, buscar_fiis, buscar_etfs, buscar_criptos, simular_carteira_monte_carlo, simular_preco_monte_carlo, detalhes_ativo, comparar_ativos, ranking, resumo_mercado, consultar_sql, cotacao_tempo_real, historico_precos, otimizar_carteira, buscar_ativos…</p>
            <pre className="code">{mcpCfg}</pre>
            <p className="muted" style={{ fontSize: 13 }}>Ou via HTTP: <code>python run_mcp.py --http</code> → <code>http://localhost:8001/mcp</code></p>
          </div>
        </div>
      </div>

      <div className="card section">
        <h2>Consulta SQL</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>Somente leitura. Tabelas: <code>acoes</code>, <code>fundos</code>, <code>etfs</code>, <code>proventos</code> e a view <code>ativos</code>.</p>
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={7}
          style={{ width: '100%', font: '12px/1.5 ui-monospace, Menlo, monospace', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)' }} />
        <div style={{ margin: '8px 0' }}><button className="btn primary" onClick={rodar}>Executar</button></div>
        {erro && <div className="alert">{erro}</div>}
        {res && (
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table>
              <thead><tr>{res.colunas.map((c) => <th key={c} className="txt">{c}</th>)}</tr></thead>
              <tbody>{res.linhas.map((l, i) => <tr key={i} style={{ cursor: 'default' }}>{l.map((v, j) => <td key={j} className="txt num">{v ?? '—'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
