"""SQLite: conexão, schema e dicionário de métricas."""
import os
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("B3_DB_PATH", ROOT / "data" / "b3.db"))

# (coluna, tipo SQL, descrição) — a descrição alimenta a API (/api/metricas), o MCP e o dashboard.
IDENT = [
    ("codigo", "TEXT PRIMARY KEY", "Código de 4 letras na B3 (ex.: BOVA, HGLG)"),
    ("ticker", "TEXT", "Ticker negociado (ex.: BOVA11)"),
    ("razao_social", "TEXT NOT NULL", "Razão social (arquivo da B3)"),
    ("nome_pregao", "TEXT", "Nome de pregão"),
    ("nome_yahoo", "TEXT", "Nome no Yahoo Finance"),
    ("categoria", "TEXT", "Categoria (ETF: Ações Brasil/Internacional/Renda Fixa/Cripto/Commodities; FII: Tijolo/Papel/FoF/Híbrido; ação: setor CVM)"),
]

MERCADO = [
    ("preco", "REAL", "Último preço (R$)"),
    ("valor_mercado", "REAL", "Valor de mercado (R$)"),
    ("cotas_emitidas", "REAL", "Cotas emitidas"),
    ("volume_medio", "REAL", "Volume médio diário (cotas)"),
    ("liquidez_media", "REAL", "Liquidez média diária (R$ = volume médio x preço)"),
    ("max_52s", "REAL", "Máxima 52 semanas"),
    ("min_52s", "REAL", "Mínima 52 semanas"),
    ("dist_max_52s", "REAL", "Distância da máxima de 52 semanas (%)"),
    ("media_50d", "REAL", "Média móvel 50 dias"),
    ("media_200d", "REAL", "Média móvel 200 dias"),
    ("retorno_1m", "REAL", "Retorno de preço 1 mês (%)"),
    ("retorno_3m", "REAL", "Retorno de preço 3 meses (%)"),
    ("retorno_6m", "REAL", "Retorno de preço 6 meses (%)"),
    ("retorno_ytd", "REAL", "Retorno de preço no ano (%)"),
    ("retorno_12m", "REAL", "Retorno de preço 12 meses (%)"),
    ("retorno_24m", "REAL", "Retorno de preço 24 meses (%)"),
    ("retorno_total_12m", "REAL", "Retorno total 12 meses com proventos reinvestidos (%)"),
    ("volatilidade_12m", "REAL", "Volatilidade anualizada 12 meses (%)"),
    ("max_drawdown_12m", "REAL", "Maior queda pico-vale em 12 meses (%)"),
    ("sharpe_12m", "REAL", "Índice de Sharpe 12m (retorno total - taxa livre de risco) / volatilidade"),
    ("beta_ibov", "REAL", "Beta contra o Ibovespa (12 meses, retornos diários)"),
    ("correlacao_ibov", "REAL", "Correlação com o Ibovespa (12 meses)"),
    ("proventos_12m", "REAL", "Proventos pagos em 12 meses (R$ por cota)"),
    ("dividend_yield", "REAL", "Dividend yield 12 meses (%) = proventos 12m / preço"),
    ("num_proventos_12m", "INTEGER", "Quantidade de pagamentos em 12 meses"),
    ("crescimento_proventos", "REAL", "Variação dos proventos 12m vs 12m anteriores (%)"),
    ("ultimo_rendimento", "REAL", "Último provento (R$ por cota)"),
    ("data_ultimo_rend", "TEXT", "Data do último provento"),
    ("status", "TEXT DEFAULT 'pendente'", "ok | sem_dados | pendente"),
    ("atualizado_em", "TEXT", "Data/hora da última coleta (UTC)"),
]

ETF_EXTRA = [
    ("pl", "REAL", "P/L — preço/lucro da carteira (trailing P/E)"),
    ("pvp", "REAL", "P/VP da carteira, quando disponível no Yahoo"),
]

FII_EXTRA = [
    ("pvp", "REAL", "P/VP = preço / valor patrimonial por cota (CVM)"),
    ("valor_patrimonial", "REAL", "Valor patrimonial por cota (R$, informe mensal CVM)"),
    ("patrimonio_liquido", "REAL", "Patrimônio líquido (R$, CVM)"),
    ("valor_ativo", "REAL", "Ativo total (R$, CVM)"),
    ("dy_anualizado", "REAL", "Último rendimento x 12 / preço (%)"),
    ("dy_12m_cvm", "REAL", "DY 12 meses sobre o patrimônio, informado à CVM (%)"),
    ("rentab_efetiva_12m", "REAL", "Rentabilidade efetiva 12 meses informada à CVM (%)"),
    ("rentab_patrimonial_12m", "REAL", "Rentabilidade patrimonial 12 meses (variação da cota patrimonial, %)"),
    ("taxa_adm_anual", "REAL", "Despesa com taxa de administração anualizada (% do PL)"),
    ("alavancagem", "REAL", "Passivo / ativo total (%)"),
    ("pct_imoveis", "REAL", "% do ativo em imóveis e direitos reais"),
    ("pct_papel", "REAL", "% do ativo em CRI/CRA/LCI/LH/LIG"),
    ("pct_fii", "REAL", "% do ativo em cotas de outros FIIs"),
    ("pct_liquidez", "REAL", "% do ativo em caixa/renda fixa (liquidez)"),
    ("cotistas", "INTEGER", "Número de cotistas"),
    ("segmento", "TEXT", "Segmento de atuação (CVM): Logística, Shoppings, Escritórios..."),
    ("mandato", "TEXT", "Mandato (CVM): Renda, Títulos e Valores Mobiliários, Desenvolvimento..."),
    ("tipo_gestao", "TEXT", "Gestão ativa (Ativa) ou passiva (Definida)"),
    ("publico_alvo", "TEXT", "Público-alvo"),
    ("administrador", "TEXT", "Administrador"),
    ("cnpj", "TEXT", "CNPJ do fundo"),
    ("data_funcionamento", "TEXT", "Início de funcionamento"),
    ("data_ref_cvm", "TEXT", "Mês de referência do último informe CVM"),
    ("alerta", "TEXT", "Aviso de qualidade de dado (ex.: DY do Yahoo diverge da CVM, baixa liquidez)"),
]

ACAO_EXTRA = [
    ("empresa", "TEXT", "Código da empresa (4 letras, ex.: PETR)"),
    ("tipo_acao", "TEXT", "ON, PN (com classe) ou Unit"),
    ("acoes_por_unit", "INTEGER", "Quantidade de ações em cada unit (1 para ações)"),
    ("segmento_listagem", "TEXT", "Segmento de listagem B3: Novo Mercado, Nível 1, Nível 2, Básico..."),
    ("cnpj", "TEXT", "CNPJ da companhia"),
    ("controle_acionario", "TEXT", "Controle acionário (CVM): privado, estatal, estrangeiro..."),
    ("setor_yahoo", "TEXT", "Setor (Yahoo, em inglês)"),
    ("industria_yahoo", "TEXT", "Indústria (Yahoo, em inglês)"),
    ("pl", "REAL", "P/L — preço / lucro por ação (12m)"),
    ("pl_projetado", "REAL", "P/L projetado (lucro estimado próximos 12m)"),
    ("pvp", "REAL", "P/VP — preço / valor patrimonial por ação"),
    ("psr", "REAL", "Preço / receita (12m)"),
    ("ev_ebitda", "REAL", "Valor da firma / EBITDA"),
    ("ev_receita", "REAL", "Valor da firma / receita"),
    ("peg", "REAL", "PEG — P/L dividido pelo crescimento esperado do lucro"),
    ("lpa", "REAL", "Lucro por ação (12m, R$)"),
    ("vpa", "REAL", "Valor patrimonial por ação (R$)"),
    ("earnings_yield", "REAL", "Lucro / preço (%) — inverso do P/L"),
    ("valor_graham", "REAL", "Preço justo de Graham = √(22,5 × LPA × VPA)"),
    ("margem_graham", "REAL", "Desconto do preço frente ao valor de Graham (%)"),
    ("roe", "REAL", "Retorno sobre patrimônio (%)"),
    ("roa", "REAL", "Retorno sobre ativos (%)"),
    ("margem_bruta", "REAL", "Margem bruta (%)"),
    ("margem_ebitda", "REAL", "Margem EBITDA (%)"),
    ("margem_operacional", "REAL", "Margem operacional (%)"),
    ("margem_liquida", "REAL", "Margem líquida (%)"),
    ("receita", "REAL", "Receita 12m (R$)"),
    ("ebitda", "REAL", "EBITDA 12m (R$)"),
    ("lucro_liquido", "REAL", "Lucro líquido 12m (R$)"),
    ("divida_total", "REAL", "Dívida bruta (R$)"),
    ("caixa", "REAL", "Caixa e equivalentes (R$)"),
    ("divida_liquida", "REAL", "Dívida bruta - caixa (R$)"),
    ("div_liq_ebitda", "REAL", "Dívida líquida / EBITDA"),
    ("divida_patrimonio", "REAL", "Dívida / patrimônio (%)"),
    ("liquidez_corrente", "REAL", "Ativo circulante / passivo circulante"),
    ("crescimento_receita", "REAL", "Crescimento da receita (trimestre a/a, %)"),
    ("crescimento_lucro", "REAL", "Crescimento do lucro (trimestre a/a, %)"),
    ("payout", "REAL", "Payout — proventos / lucro (%)"),
    ("free_float", "REAL", "Ações em circulação livre (% do total)"),
    ("preco_alvo", "REAL", "Preço-alvo médio dos analistas (R$)"),
    ("potencial_alvo", "REAL", "Potencial até o preço-alvo (%)"),
    ("recomendacao", "TEXT", "Recomendação média dos analistas (Yahoo)"),
    ("num_analistas", "INTEGER", "Número de analistas cobrindo"),
    ("alerta", "TEXT", "Aviso de qualidade de dado (ex.: múltiplos de unit estimados, baixa liquidez)"),
]

TABELAS = {
    "etfs": IDENT + MERCADO + ETF_EXTRA,
    "fundos": IDENT + MERCADO + FII_EXTRA,
    "acoes": IDENT + MERCADO + ACAO_EXTRA,
}

COMUNS = [c for c, _, _ in IDENT + MERCADO]


def _ddl() -> str:
    parts = []
    for tabela, cols in TABELAS.items():
        body = ",\n    ".join(f"{c} {t}" for c, t, _ in cols)
        parts.append(f"CREATE TABLE IF NOT EXISTS {tabela} (\n    {body}\n);")
    cols = ", ".join(COMUNS)
    parts.append(f"""
CREATE TABLE IF NOT EXISTS proventos (
    codigo TEXT NOT NULL,
    tipo   TEXT NOT NULL,   -- ETF | FII | ACAO
    data   TEXT NOT NULL,
    valor  REAL NOT NULL,
    PRIMARY KEY (codigo, data)
);
DROP VIEW IF EXISTS ativos;
CREATE VIEW ativos AS
    SELECT 'ETF' AS tipo, {cols}, pl, pvp FROM etfs
    UNION ALL
    SELECT 'FII' AS tipo, {cols}, NULL AS pl, pvp FROM fundos
    UNION ALL
    SELECT 'ACAO' AS tipo, {cols}, pl, pvp FROM acoes;
CREATE INDEX IF NOT EXISTS idx_fundos_categoria ON fundos(categoria);
CREATE INDEX IF NOT EXISTS idx_fundos_segmento ON fundos(segmento);
CREATE INDEX IF NOT EXISTS idx_fundos_dy ON fundos(dividend_yield);
CREATE INDEX IF NOT EXISTS idx_fundos_pvp ON fundos(pvp);
CREATE INDEX IF NOT EXISTS idx_etfs_categoria ON etfs(categoria);
CREATE INDEX IF NOT EXISTS idx_acoes_categoria ON acoes(categoria);
CREATE INDEX IF NOT EXISTS idx_acoes_empresa ON acoes(empresa);
""")
    return "\n".join(parts)


SCHEMA = _ddl()


def colunas(tabela: str) -> list[str]:
    return [c for c, _, _ in TABELAS[tabela]]


def sem_acento(v):
    """Minúsculas sem acento — usada como função SQL norm() para buscas ('logística' casa com 'LOGISTICA')."""
    if v is None:
        return None
    return "".join(c for c in unicodedata.normalize("NFD", str(v)) if unicodedata.category(c) != "Mn").lower()


def connect(readonly: bool = False) -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if readonly:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    else:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.create_function("norm", 1, sem_acento, deterministic=True)
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        # migração leve: adiciona colunas novas em bancos já existentes
        for tabela, cols in TABELAS.items():
            existentes = {r["name"] for r in conn.execute(f"PRAGMA table_info({tabela})")}
            for c, t, _ in cols:
                if c not in existentes:
                    conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {c} {t.replace('PRIMARY KEY', '')}")
