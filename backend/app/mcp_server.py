"""Servidor MCP — permite que uma IA (Claude Desktop, Claude Code, Cursor...) consulte ETFs e FIIs.

Rodar (stdio):   python -m app.mcp_server
Rodar (HTTP):    python -m app.mcp_server --http   -> http://localhost:8001/mcp
"""
import sys
from typing import Literal

from mcp.server.mcpserver import MCPServer

from . import ingest, montecarlo, portfolio, repository as repo, yahoo
from .db import SCHEMA, init_db

mcp = MCPServer(
    "b3-fundos",
    instructions=(
        "Dados de ações, ETFs e FIIs (fundos imobiliários) listados na B3 e das maiores criptomoedas (em reais, ticker BTC-BRL). "
        "Use `dicionario_metricas` para ver as colunas. "
        "Filtros numéricos: {'coluna': [min, max]} (use null para sem limite). Percentuais estão em % (10 = 10%). "
        "Para cotações ao vivo use `cotacao_tempo_real`. Para perguntas agregadas use `consultar_sql`."
    ),
    version="1.0.0",
)

Filtros = dict[str, list[float | None]] | None


def _faixas(filtros: Filtros) -> dict:
    return {k: (v[0] if len(v) > 0 else None, v[1] if len(v) > 1 else None) for k, v in (filtros or {}).items()}


@mcp.tool()
def buscar_etfs(
    busca: str | None = None,
    categoria: str | None = None,
    filtros: Filtros = None,
    ordenar: str = "liquidez_media",
    ordem: Literal["asc", "desc"] = "desc",
    limite: int = 20,
) -> dict:
    """Busca ETFs da B3. categoria: Ações Brasil | Internacional | Renda Fixa | Cripto | Commodities.
    filtros ex.: {"pl": [null, 10], "retorno_12m": [15, null], "liquidez_media": [1000000, null]}."""
    return repo.listar("etf", busca=busca, categoria=categoria, faixas=_faixas(filtros),
                       ordenar=ordenar, ordem=ordem, limite=limite)


@mcp.tool()
def buscar_fiis(
    busca: str | None = None,
    categoria: str | None = None,
    segmento: str | None = None,
    filtros: Filtros = None,
    ordenar: str = "dividend_yield",
    ordem: Literal["asc", "desc"] = "desc",
    limite: int = 20,
) -> dict:
    """Busca fundos imobiliários. categoria: Tijolo | Papel | FoF | Híbrido. segmento (CVM): Logística, Shoppings,
    Escritórios, Residencial, Hospital, Varejo, Hotel, Multicategoria...
    filtros ex.: {"pvp": [null, 0.95], "dividend_yield": [10, null], "liquidez_media": [500000, null], "cotistas": [10000, null]}."""
    return repo.listar("fii", busca=busca, categoria=categoria, segmento=segmento, faixas=_faixas(filtros),
                       ordenar=ordenar, ordem=ordem, limite=limite)


@mcp.tool()
def buscar_acoes(
    busca: str | None = None,
    setor: str | None = None,
    segmento_listagem: str | None = None,
    filtros: Filtros = None,
    ordenar: str = "liquidez_media",
    ordem: Literal["asc", "desc"] = "desc",
    limite: int = 20,
) -> dict:
    """Busca ações e units da B3. setor = setor CVM (ex.: 'Bancos', 'Energia Elétrica'; ver valores_coluna('acao','categoria')).
    segmento_listagem: Novo Mercado, Nível 1/2 de Governança Corporativa, Básico...
    Métricas: pl, pvp, ev_ebitda, roe, roa, margem_liquida, div_liq_ebitda, dividend_yield, payout, margem_graham, potencial_alvo...
    filtros ex.: {"pl": [0, 10], "roe": [15, null], "div_liq_ebitda": [null, 2], "liquidez_media": [5000000, null]}."""
    return repo.listar("acao", busca=busca, categoria=setor, segmento=segmento_listagem, faixas=_faixas(filtros),
                       ordenar=ordenar, ordem=ordem, limite=limite)


@mcp.tool()
def buscar_criptos(
    busca: str | None = None,
    categoria: str | None = None,
    filtros: Filtros = None,
    ordenar: str = "valor_mercado",
    ordem: Literal["asc", "desc"] = "desc",
    limite: int = 20,
) -> dict:
    """Busca criptomoedas (maiores por valor de mercado). Preços e retornos em reais; anualização com 365 dias.
    categoria: Stablecoin, Reserva de valor, Plataforma (L1), Pagamentos, Layer 2 / escalabilidade, DeFi,
    Infraestrutura / oráculos, Token de corretora, Meme, Games / metaverso, Derivativo (wrapped/staking), Outros.
    Métricas: rank_mercado, retorno_12m, volatilidade_12m, max_drawdown_12m, sharpe_12m, sortino_12m, correlacao_btc,
    beta_btc, beta_ibov, dist_ath, mcap_fdv, pct_emitido, volume_mcap...
    filtros ex.: {"rank_mercado": [null, 20], "correlacao_btc": [null, 0.6], "mcap_fdv": [80, null]}."""
    return repo.listar("cripto", busca=busca, categoria=categoria, faixas=_faixas(filtros),
                       ordenar=ordenar, ordem=ordem, limite=limite)


@mcp.tool()
def detalhes_ativo(codigo: str) -> dict:
    """Todas as métricas salvas de uma ação, ETF, FII ou cripto (ex.: 'PETR4', 'HGLG11', 'BOVA11', 'BTC') + proventos recentes."""
    for tipo in ("acao", "fii", "etf", "cripto"):
        r = repo.obter(tipo, codigo)
        if r:
            return {"tipo": tipo.upper(), **r}
    return {"erro": f"{codigo} não encontrado na base"}


@mcp.tool()
def comparar_ativos(codigos: list[str]) -> list[dict]:
    """Compara ações, ETFs e FIIs lado a lado. Ex.: ["ITUB4", "BBDC4", "BBAS3"] ou ["HGLG11", "BTLG11"]."""
    return repo.comparar(codigos)


@mcp.tool()
def ranking(
    tipo: Literal["etf", "fii", "acao", "cripto"],
    metrica: str,
    n: int = 10,
    ordem: Literal["asc", "desc"] = "desc",
    categoria: str | None = None,
    liquidez_minima: float | None = 100_000,
) -> list[dict]:
    """Top N por uma métrica (ex.: dividend_yield, pvp, retorno_12m, sharpe_12m). Use ordem='asc' para menores
    valores (ex.: menor P/VP). liquidez_minima em R$/dia filtra ativos pouco negociados."""
    faixas = {"liquidez_media": (liquidez_minima, None)} if liquidez_minima else {}
    return repo.listar(tipo, categoria=categoria, faixas=faixas, ordenar=metrica, ordem=ordem, limite=n,
                       campos=["codigo", "ticker", "nome_pregao", "categoria", metrica, "preco", "liquidez_media"])["itens"]


@mcp.tool()
def resumo_mercado() -> dict:
    """Visão geral da base: totais e medianas/médias de DY, P/VP, P/L, retornos por categoria."""
    return repo.resumo()


@mcp.tool()
def dicionario_metricas() -> dict:
    """Lista todas as colunas disponíveis para ETFs e FIIs, com descrição."""
    return repo.dicionario()


@mcp.tool()
def valores_coluna(tipo: Literal["etf", "fii", "acao", "cripto"], coluna: str) -> list[dict]:
    """Valores distintos de uma coluna de texto (ex.: tipo='fii', coluna='segmento' ou 'administrador')."""
    return repo.valores_distintos(tipo, coluna)


@mcp.tool()
def consultar_sql(query: str, limite: int = 200) -> dict:
    """Executa um SELECT no SQLite (somente leitura). Tabelas: etfs, fundos, acoes, proventos(codigo,tipo,data,valor)
    e view ativos (ETFs+FIIs, colunas comuns + tipo). Ex.:
    SELECT segmento, COUNT(*), ROUND(AVG(pvp),2) FROM fundos WHERE status='ok' GROUP BY segmento"""
    return repo.sql_somente_leitura(query, limite)


@mcp.tool()
def cotacao_tempo_real(ticker: str) -> dict:
    """Cotação ao vivo no Yahoo Finance: preço, variação, volume, máx/mín, P/L, P/VP, valor de mercado.
    Aceita B3 (HGLG11, PETR4) e outros mercados (AAPL, ^BVSP, BTC-USD)."""
    return yahoo.cotacao(ticker)


@mcp.tool()
def historico_precos(
    ticker: str,
    periodo: Literal["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"] = "6mo",
    intervalo: Literal["1d", "1wk", "1mo"] = "1wk",
) -> list[dict]:
    """Histórico de preços (OHLCV + dividendos) do Yahoo Finance."""
    return yahoo.historico(ticker, periodo, intervalo)


@mcp.tool()
def otimizar_carteira(
    tickers: list[str],
    valor: float = 1000,
    peso_min: float = 0.0,
    peso_max: float = 0.35,
    filosofia: str | None = None,
    indicadores: list[str] | None = None,
    periodo: Literal["1y", "2y", "5y", "10y"] = "2y",
) -> dict:
    """Otimização de carteira (Markowitz e variações) com alocação em cotas inteiras ao preço atual.
    filosofia: value_conservador | renda | defensivo | equilibrado | crescimento (define os indicadores).
    indicadores: sharpe, sortino, calmar, renda_risco, omega, min_vol, min_cvar, min_drawdown, risk_parity, max_dy, max_retorno.
    Pesos em fração (0.35 = 35%). Sempre inclui a carteira de pesos iguais como referência."""
    r = portfolio.otimizar(tickers, valor, peso_min, peso_max, indicadores, filosofia, periodo)
    r.pop("fronteira", None)
    return r


@mcp.tool()
def simular_carteira_monte_carlo(
    tickers: list[str],
    pesos: list[float] | None = None,
    valor_inicial: float = 10000,
    aporte_mensal: float = 0,
    anos: float = 10,
    meta: float | None = None,
    inflacao: float = 0.0,
    metodo: Literal["bootstrap", "normal", "t"] = "bootstrap",
    simulacoes: int = 3000,
) -> dict:
    """Monte Carlo do patrimônio de uma carteira (retorno total, rebalanceada aos pesos; aporte no fim do mês).
    Retorna percentis do valor final, probabilidade de perda e de superar a renda fixa, CAGR e drawdown por cenário;
    com `meta`, a chance de atingi-la e o aporte mensal necessário para 50/75/90%. inflacao (0.045 = 4,5%) põe tudo
    em reais de hoje. Cripto: use o ticker em reais (BTC-BRL)."""
    r = montecarlo.simular_carteira(tickers, pesos, valor_inicial, aporte_mensal, anos, simulacoes, metodo, meta=meta, inflacao=inflacao)
    for k in ("bandas", "caminhos", "histograma", "investido", "renda_fixa", "datas"):
        r.pop(k, None)
    return r


@mcp.tool()
def simular_preco_monte_carlo(ticker: str, dias: int = 252, metodo: Literal["bootstrap", "normal", "t"] = "bootstrap",
                              alvo_alta: float = 20, alvo_queda: float = -20) -> dict:
    """Cone de preço de um ativo por Monte Carlo: percentis do preço no horizonte (pregões; dias corridos para cripto),
    chance de alta, de tocar +alvo_alta% / alvo_queda% em algum momento e VaR/CVaR 95%."""
    r = montecarlo.simular_ativo(ticker, dias, metodo=metodo, alvo_alta=alvo_alta, alvo_queda=alvo_queda)
    for k in ("bandas", "caminhos", "histograma", "historico", "datas"):
        r.pop(k, None)
    return r


@mcp.tool()
def buscar_ativos(texto: str, limite: int = 10) -> list[dict]:
    """Procura ações, ETFs, FIIs e criptos pelo código ou nome (ex.: 'itau', 'ouro', 'logística', 'MXRF', 'solana')."""
    return repo.buscar(texto, limite)


@mcp.tool()
def atualizar_ativo(tipo: Literal["etf", "fii", "acao"], codigo: str) -> dict:
    """Recoleta as métricas de um ativo no Yahoo e grava no banco."""
    tabela = repo.tabela_de(tipo)
    base = codigo.upper().replace(".SA", "")
    if tabela != "acoes":
        base = base.rstrip("0123456789")
    ingest.atualizar(tabela, base)
    return repo.obter(tipo, base) or {"erro": "não encontrado"}


@mcp.resource("b3://schema")
def schema() -> str:
    """DDL do banco SQLite."""
    return SCHEMA


def main():
    init_db()
    if "--http" in sys.argv:
        mcp.run(transport="streamable-http", port=8001)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
