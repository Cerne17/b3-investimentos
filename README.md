# B3 Fundos — Ações, ETFs, FIIs & Cripto

Base SQLite + API REST (FastAPI/Swagger) + servidor MCP + dashboard React para ações, ETFs e FIIs listados na B3 e as
maiores criptomoedas, com otimização de carteira, simulações de Monte Carlo e um home broker de acompanhamento.

```
data/            CSVs da B3 (etfsListados.csv, fundosListados.csv) e o banco b3.db
backend/app/
  db.py          schema SQLite + dicionário de métricas
  yahoo.py       coleta Yahoo Finance (métricas + tempo real, ajuste de desdobramentos)
  cvm.py         informe mensal de FIIs da CVM (VP/cota, PL, cotistas, segmento, carteira)
  cripto.py      maiores criptos (CoinGecko) + histórico do Yahoo convertido para reais
  portfolio.py   otimização de carteira (Markowitz e variações)
  montecarlo.py  simulações de patrimônio, meta e cone de preço
  ingest.py      carga dos CSVs + coleta → SQLite
  repository.py  consultas (usadas pela API e pelo MCP)
  main.py        API REST (Swagger em /docs) — também serve o dashboard
  mcp_server.py  servidor MCP
frontend/        dashboard React (Vite)
postman_openapi.json  especificação OpenAPI para importar no Postman
```

## Fontes e métricas

| Fonte | O quê |
|---|---|
| CSVs da B3 | lista de ativos (razão social, nome de pregão, código) |
| Yahoo Finance | preço, liquidez, retornos 1m/3m/6m/ano/12m/24m, retorno total com proventos, volatilidade, drawdown, Sharpe, beta e correlação com o IBOV, médias móveis, proventos (DY, último rendimento, consistência e crescimento), P/L dos ETFs |
| CVM (Formulário Cadastral + cadastro de companhias) | lista de ações/units negociadas (ticker, ON/PN/Unit, composição da unit), segmento de listagem, setor, controle acionário |
| Yahoo Finance (ações) | P/L, P/L projetado, P/VP, P/Receita, EV/EBITDA, PEG, LPA, VPA, valor e margem de Graham, ROE, ROA, margens, receita, EBITDA, lucro, dívida líquida/EBITDA, liquidez corrente, crescimento, payout, preço-alvo e recomendação dos analistas |
| CoinGecko + Yahoo Finance (cripto) | universo das ~150 maiores por valor de mercado, oferta circulante/máxima, FDV, máxima histórica; histórico diário do par em dólar × câmbio USD/BRL de cada dia → retornos, volatilidade (365 dias), drawdown, Sharpe, Sortino, beta/correlação com BTC e IBOV |
| CVM (informe mensal) | VP/cota → P/VP, patrimônio líquido, ativo total, cotistas, alavancagem, taxa de administração, rentabilidade efetiva/patrimonial 12m, DY informado, % imóveis/papel/FIIs/caixa, segmento, mandato, gestão, administrador |

`GET /api/metricas` lista as ~45 colunas de cada tabela com descrição.
FIIs com dado suspeito (DY do Yahoo muito diferente da CVM, P/VP fora do usual, baixa liquidez) têm a coluna `alerta` preenchida.

## Rodando

O repositório já traz `data/b3.db` populado (coleta de 26/10/2026), então a API sobe com dados na hora.
Rode o `ingest` para atualizar.

```bash
cd backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt   # ou: python -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python -m app.ingest                 # carrega CSVs + CVM + Yahoo (~15 min)
.venv/bin/python -m app.ingest --only acao     # só ações
.venv/bin/python -m app.ingest --only cripto   # só criptos (--limit N = quantas moedas, padrão 150)
.venv/bin/python -m app.ingest --pendentes     # repete só o que falhou (rate limit do Yahoo)

cd ../frontend && npm install && npm run build  # gera o dashboard que a API serve
cd ../backend && .venv/bin/uvicorn app.main:app --port 8000     # API + dashboard
```

- Dashboard: http://localhost:8000
- Swagger: http://localhost:8000/docs · ReDoc: /redoc
- Postman: *Import → Link* `http://localhost:8000/openapi.json` (ou importe o arquivo `postman_openapi.json`)

Desenvolvimento do front com hot reload: `cd frontend && npm install && npm run dev` (http://localhost:5173, com proxy para a API). Depois `npm run build` para a API servir a versão nova.

## Deploy (Vercel)

Em produção em **https://b3.cerne.pro** (projeto Vercel `b3-investimentos`).

- `index.py` expõe o app FastAPI como função Python; o build (`vercel.json`) gera o dashboard em `frontend/dist`,
  que o próprio FastAPI serve (assets com cache imutável).
- Na Vercel o disco é somente leitura: o `data/b3.db` vai empacotado como snapshot imutável e os endpoints de
  escrita (`/api/atualizar/...`) respondem 403. Para atualizar os dados: rode o `ingest` localmente, faça commit do
  `b3.db` e publique de novo (`vercel deploy --prod`).
- Cotações em tempo real e a otimização de carteira funcionam normalmente (consultam o Yahoo na hora).
- O MCP roda localmente (stdio ou `--http`), apontando para o banco local.

## Exemplos de API

```bash
# FIIs de logística descontados, líquidos e que pagaram todo mês
curl "localhost:8000/api/fiis?segmento=Logística&max_pvp=0.95&min_liquidez_media=1000000&min_num_proventos_12m=12"

# ETFs internacionais com volatilidade abaixo de 20%, ordenados pelo Sharpe
curl "localhost:8000/api/etfs?categoria=Internacional&max_volatilidade_12m=20&ordenar=sharpe_12m"

# Top 10 menores P/VP entre FIIs líquidos
curl "localhost:8000/api/ranking/fiis/pvp?ordem=asc&min_liquidez_media=1000000&min_pvp=0.1"

# SQL livre (somente leitura)
curl -X POST localhost:8000/api/sql -H 'content-type: application/json' \
  -d '{"query":"SELECT segmento, COUNT(*) n, ROUND(AVG(dividend_yield),2) dy FROM fundos WHERE status=\"ok\" GROUP BY segmento"}'

# Tempo real (qualquer ticker do Yahoo)
curl localhost:8000/api/tempo-real/cotacao/HGLG11
curl "localhost:8000/api/tempo-real/historico/BOVA11?periodo=1y&intervalo=1wk"
curl "localhost:8000/api/tempo-real/historico/BTC-BRL?periodo=24h&intervalo=5m"   # 1d = último pregão, 24h e 7d = janelas móveis
```

Toda coluna numérica aceita `min_<coluna>` / `max_<coluna>`.

## Dashboard

- **FIIs / ETFs:** filtros, atalhos, colunas extras e exportação CSV. Marque linhas para abrir uma **tabela
  comparativa** (métricas por grupo, melhor valor destacado, "só diferenças", salvar comparativos, CSV).
- **Tempo real:** view *Padrão* (lista de cotações, um ativo por vez) e views customizadas salvas no navegador:
  - *Indicadores* — um ativo com fórmulas padrão (médias, Bollinger, Donchian, RSI, MACD, estocástico,
    volatilidade, drawdown, retorno acumulado, momentum, z-score, volume) e **fórmulas customizadas**, ex.:
    `(close / sma(close, 200) - 1) * 100`. Variáveis `close open high low volume div`; funções
    `sma ema std max min lag pct rsi zscore cumsum cummax cummin first abs log sqrt exp`.
  - *Comparação* — até 8 ativos no mesmo gráfico (uma cor cada), em base 100, variação %, preço ou uma
    fórmula aplicada a cada ativo.

## Criptomoedas

Ticker no app e na API: `BTC-BRL`, `SOL-BRL`... (o par em dólar do Yahoo multiplicado pelo câmbio). `BTC-USD` também
funciona em tempo real. Símbolos repetidos no Yahoo são resolvidos pelo preço do CoinGecko (ex.: HYPE → `HYPE32196-USD`).
Categorias: Stablecoin, Reserva de valor, Plataforma (L1), Pagamentos, Layer 2, DeFi, Infraestrutura/oráculos, Token de
corretora, Meme, Games, Ativo tokenizado (RWA), Lastreada em ouro, Derivativo (wrapped/staking). A coluna `alerta` marca
stablecoin fora da paridade, giro baixo, muita emissão futura (valor de mercado < 50% do FDV) e histórico curto.

Na carteira, cripto entra com quantidade fracionária e, misturada a ativos da bolsa, o retorno é medido nos pregões
(o fim de semana da cripto entra no retorno de segunda).

## Monte Carlo

```bash
# patrimônio em 10 anos com R$ 400 + R$ 400/mês, em reais de hoje (IPCA 4,5%), e chance de chegar a R$ 100 mil
curl -X POST localhost:8000/api/montecarlo/carteira -H 'content-type: application/json' -d '{
  "tickers": ["MXRF11", "GOLD11", "AUVP11", "BTC-BRL"], "pesos": [0.35, 0.3, 0.3, 0.05],
  "valor_inicial": 400, "aporte_mensal": 400, "anos": 10, "meta": 100000, "inflacao": 0.045
}'

# carteira de renda: proventos sacados todo mês e chance de chegar a R$ 3 mil/mês em 15 anos
curl -X POST localhost:8000/api/montecarlo/carteira -H 'content-type: application/json' -d '{
  "tickers": ["MXRF11", "TVRI11", "BBSE3", "TAEE11"], "valor_inicial": 20000, "aporte_mensal": 1000, "anos": 15,
  "proventos": "sacar", "meta_tipo": "renda", "meta": 3000, "inflacao": 0.045
}'

# cone de preço do bitcoin em 1 ano
curl -X POST localhost:8000/api/montecarlo/ativo -H 'content-type: application/json' -d '{"ticker": "BTC-BRL", "dias": 365}'
```

Métodos: `bootstrap` (blocos de 20 dias do histórico real — mantém caudas gordas e a correlação entre os ativos),
`normal` (GBM) e `t` (t de Student, 4 graus de liberdade). A carteira é rebalanceada aos pesos; o aporte entra no fim de
cada mês. Com `meta`, a resposta traz a chance de atingi-la (no fim e ano a ano), o mês mediano em que chega lá e o aporte
mensal necessário para 50/75/90% de chance (o valor final é linear no aporte para os mesmos sorteios, então sai por
bisseção sem simular de novo).

Proventos (`proventos`): `reinvestir` (retorno total) ou `sacar` — o patrimônio cresce só pelo preço e o provento vira
renda. Nos dois casos a resposta traz `renda`: renda mensal (média de 12 meses) no 1º ano e no fim, leque mês a mês,
total recebido e yield on cost. No bootstrap a renda vem dos proventos dos mesmos dias sorteados; nos métodos
paramétricos, do rendimento médio histórico. Com `meta_tipo: "renda"`, `meta` é a renda mensal desejada no fim do
horizonte (o aporte necessário também sai por bisseção). Sem imposto de renda.

## Home Broker

Aba de acompanhamento (sem ordens): várias carteiras com quantidade e preço médio, cotações a cada 30 s, variação do
dia, resultado por ativo, renda passiva estimada pelos proventos de 12 meses, alocação por ativo e por classe e o valor
da carteira atual ao longo do dia/semana/mês/ano. O painel de proventos mostra o recebido por mês nos últimos 12 meses
(com as quantidades de hoje), pagamentos e yield on cost por ativo e o progresso até uma meta de renda mensal
(`GET /api/tempo-real/proventos?tickers=MXRF11,PETR4`). As carteiras ficam no `localStorage` do navegador (exportar/importar
JSON); a aba Markowitz manda uma carteira otimizada direto para o Home Broker ou para o Monte Carlo.

## Markowitz

`POST /api/carteira/otimizar` — e a aba **Markowitz** do dashboard — otimizam uma carteira com retornos diários
totais (preço + proventos reinvestidos, ajustados por desdobramentos) e convertem os pesos em **cotas inteiras ao
preço atual** (busca local que minimiza o desvio em R$ do alvo e a sobra, sem passar do peso máximo).

```bash
curl -X POST localhost:8000/api/carteira/otimizar -H 'content-type: application/json' -d '{
  "tickers": ["MXRF11", "GARE11", "GOLD11", "AUVP11"], "valor": 400,
  "peso_min": 0, "peso_max": 0.35, "filosofia": "value_conservador"
}'
```

`dy_min` (% a.a.) impõe um dividend yield mínimo a todas as carteiras otimizadas (e à fronteira); cada carteira traz a
renda mensal estimada da alocação (`alocacao.renda_mensal`).

Indicadores (`indicadores`): `sharpe`, `sortino`, `calmar`, `renda_risco` (DY/volatilidade), `omega`, `min_vol`,
`min_cvar`, `min_drawdown`, `risk_parity`, `max_dy`, `max_retorno`.
Filosofias (`filosofia`) que escolhem os indicadores sozinhas: `value_conservador`, `renda`, `defensivo`,
`equilibrado`, `crescimento` (`GET /api/carteira/opcoes`). A resposta sempre traz também a carteira de pesos
iguais, métricas por ativo, matriz de correlação e a fronteira eficiente.

## MCP

Ferramentas: `buscar_acoes`, `buscar_fiis`, `buscar_etfs`, `buscar_criptos`, `simular_carteira_monte_carlo`,
`simular_preco_monte_carlo`, `detalhes_ativo`, `comparar_ativos`, `ranking`, `resumo_mercado`,
`dicionario_metricas`, `valores_coluna`, `consultar_sql`, `cotacao_tempo_real`, `historico_precos`, `buscar_ativos`,
`otimizar_carteira`, `atualizar_ativo`.

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "b3-fundos": {
      "command": "/CAMINHO/backend/.venv/bin/python",
      "args": ["/CAMINHO/backend/run_mcp.py"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add b3-fundos -- /CAMINHO/backend/.venv/bin/python /CAMINHO/backend/run_mcp.py
```

Modo HTTP (para clientes remotos): `python run_mcp.py --http` → `http://localhost:8001/mcp`.

## Observações

- Dados do Yahoo Finance são não oficiais e podem ter atraso/falhas; o coletor tenta de novo em caso de rate limit.
- Desdobramentos/grupamentos que o Yahoo não ajusta são detectados por saltos de preço > 60% e corrigidos no histórico.
- ~110 FIIs da lista da B3 não têm negociação no Yahoo (`status = 'sem_dados'`), mas mantêm os dados da CVM.
- Units (TAEE11, SANB11...): o Yahoo mistura bases por ação e por unit; P/L e LPA são estimados por P/VP ÷ ROE
  e marcados na coluna `alerta`.
- Sharpe usa taxa livre de risco de 14% a.a. (variável `B3_TAXA_LIVRE_RISCO`).
- A API não tem autenticação — pensada para uso local.

> Dados de mercado são do Yahoo Finance (não oficiais) e da CVM. Uso educacional — não é recomendação de investimento.
