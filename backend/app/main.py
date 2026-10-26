"""API REST — ETFs e FIIs da B3 (SQLite + Yahoo Finance em tempo real).

Rodar:  uvicorn app.main:app --reload --port 8000
Docs:   http://localhost:8000/docs  (Swagger)  ·  /redoc  ·  /openapi.json (importável no Postman)
"""
import threading
from datetime import datetime, timezone
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException, Path as P, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ingest, portfolio, repository as repo, yahoo
from .db import ROOT, SOMENTE_LEITURA, init_db

TAGS = [
    {"name": "ETFs", "description": "ETFs listados na B3 armazenados no SQLite."},
    {"name": "FIIs", "description": "Fundos imobiliários listados na B3 (Yahoo + informe mensal CVM)."},
    {"name": "Ações", "description": "Ações e units da B3 (lista do Formulário Cadastral da CVM + fundamentos do Yahoo)."},
    {"name": "Análises", "description": "Resumo, rankings, comparações, dicionário de métricas e SQL livre (somente leitura). Tabelas: etfs, fundos, acoes, proventos e view ativos."},
    {"name": "Tempo real", "description": "Consultas diretas ao Yahoo Finance (cache de 30 s). Aceita qualquer ticker: HGLG11, PETR4, AAPL, ^BVSP, BTC-USD."},
    {"name": "Carteira", "description": "Otimização de carteira (Markowitz, Sharpe, Sortino, Calmar, CVaR, paridade de risco...) com alocação em cotas inteiras."},
    {"name": "Atualização", "description": "Recoleta dados e grava no SQLite."},
]

app = FastAPI(
    title="B3 Fundos API",
    version="1.0.0",
    description=(
        "API para consultar métricas de **ETFs** e **FIIs** listados na B3.\n\n"
        "* Base local SQLite alimentada pelos arquivos `etfsListados.csv` e `fundosListados.csv`, "
        "Yahoo Finance (preço, retornos, risco, proventos) e informe mensal da CVM (VP/cota, PL, cotistas, segmento, carteira).\n"
        "* **Filtros dinâmicos:** toda coluna numérica aceita `min_<coluna>` e `max_<coluna>` "
        "(ex.: `min_dividend_yield=10&max_pvp=0.9&min_liquidez_media=1000000`). Veja `GET /api/metricas`.\n"
        "* Para usar no Postman: *Import → Link* com `http://localhost:8000/openapi.json`."
    ),
    openapi_tags=TAGS,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup():
    init_db()


def _faixas(request: Request, tabela: str) -> dict:
    nums = set(repo.numericas(tabela))
    faixas: dict[str, list] = {}
    for k, v in request.query_params.items():
        for pref, idx in (("min_", 0), ("max_", 1)):
            if k.startswith(pref):
                col = k[len(pref):]
                if col not in nums:
                    raise HTTPException(400, f"Filtro {k}: coluna numérica desconhecida '{col}'")
                try:
                    faixas.setdefault(col, [None, None])[idx] = float(v)
                except ValueError:
                    raise HTTPException(400, f"Filtro {k}: valor numérico inválido '{v}'")
    return {k: tuple(v) for k, v in faixas.items()}


def _listar(tipo: str, request: Request, **kw):
    try:
        return repo.listar(tipo, faixas=_faixas(request, repo.tabela_de(tipo)), **kw)
    except ValueError as e:
        raise HTTPException(400, str(e))


def _obter(tipo: str, codigo: str):
    r = repo.obter(tipo, codigo)
    if not r:
        raise HTTPException(404, f"{codigo} não encontrado")
    return r


Ordem = Literal["asc", "desc"]

# ---------------- ETFs ----------------


@app.get("/api/etfs", tags=["ETFs"], summary="Lista/filtra ETFs")
def listar_etfs(
    request: Request,
    busca: str | None = Query(None, description="Texto no código, ticker, razão social ou nome de pregão"),
    categoria: str | None = Query(None, description="Ações Brasil | Internacional | Renda Fixa | Cripto | Commodities"),
    min_pl: float | None = Query(None, description="P/L mínimo"),
    max_pl: float | None = Query(None, description="P/L máximo"),
    min_dividend_yield: float | None = Query(None, description="DY 12m mínimo (%)"),
    min_retorno_12m: float | None = Query(None, description="Retorno 12m mínimo (%)"),
    max_volatilidade_12m: float | None = Query(None, description="Volatilidade anualizada máxima (%)"),
    min_liquidez_media: float | None = Query(None, description="Liquidez média diária mínima (R$)"),
    somente_com_dados: bool = True,
    ordenar: str = Query("liquidez_media", description="Coluna para ordenar (ver /api/metricas)"),
    ordem: Ordem = "desc",
    limite: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Qualquer outra coluna numérica também aceita `min_<coluna>` / `max_<coluna>`
    (ex.: `max_beta_ibov=0.5`, `min_sharpe_12m=0`)."""
    return _listar("etf", request, busca=busca, categoria=categoria, somente_com_dados=somente_com_dados,
                   ordenar=ordenar, ordem=ordem, limite=limite, offset=offset)


@app.get("/api/etfs/{codigo}", tags=["ETFs"], summary="Detalhe de um ETF")
def obter_etf(codigo: str = P(..., examples=["BOVA11"])):
    return _obter("etf", codigo)


# ---------------- FIIs ----------------


@app.get("/api/fiis", tags=["FIIs"], summary="Lista/filtra FIIs")
def listar_fiis(
    request: Request,
    busca: str | None = Query(None, description="Texto no código, ticker, razão social ou nome de pregão"),
    categoria: str | None = Query(None, description="Tijolo | Papel | FoF | Híbrido"),
    segmento: str | None = Query(None, description="Segmento CVM: Logística, Shoppings, Escritórios... (ver /api/fiis/valores/segmento)"),
    min_dividend_yield: float | None = Query(None, description="DY 12m mínimo (%)"),
    max_dividend_yield: float | None = Query(None, description="DY 12m máximo (%)"),
    min_pvp: float | None = Query(None, description="P/VP mínimo"),
    max_pvp: float | None = Query(None, description="P/VP máximo"),
    min_liquidez_media: float | None = Query(None, description="Liquidez média diária mínima (R$)"),
    min_patrimonio_liquido: float | None = Query(None, description="Patrimônio líquido mínimo (R$)"),
    min_cotistas: float | None = Query(None, description="Número mínimo de cotistas"),
    max_alavancagem: float | None = Query(None, description="Alavancagem máxima (% passivo/ativo)"),
    somente_com_dados: bool = True,
    ordenar: str = Query("dividend_yield", description="Coluna para ordenar (ver /api/metricas)"),
    ordem: Ordem = "desc",
    limite: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Qualquer outra coluna numérica também aceita `min_<coluna>` / `max_<coluna>`
    (ex.: `min_num_proventos_12m=12`, `max_taxa_adm_anual=1`, `min_pct_imoveis=80`)."""
    return _listar("fii", request, busca=busca, categoria=categoria, segmento=segmento,
                   somente_com_dados=somente_com_dados, ordenar=ordenar, ordem=ordem, limite=limite, offset=offset)


@app.get("/api/fiis/{codigo}", tags=["FIIs"], summary="Detalhe de um FII")
def obter_fii(codigo: str = P(..., examples=["HGLG11"])):
    return _obter("fii", codigo)


@app.get("/api/acoes", tags=["Ações"], summary="Lista/filtra ações")
def listar_acoes(
    request: Request,
    busca: str | None = Query(None, description="Ticker, empresa ou nome"),
    categoria: str | None = Query(None, description="Setor CVM (ver /api/acoes/valores/categoria)"),
    segmento: str | None = Query(None, description="Segmento de listagem: Novo Mercado, Nível 1/2 de Governança, Básico..."),
    min_dividend_yield: float | None = Query(None, description="DY 12m mínimo (%)"),
    max_pl: float | None = Query(None, description="P/L máximo"),
    max_pvp: float | None = Query(None, description="P/VP máximo"),
    min_roe: float | None = Query(None, description="ROE mínimo (%)"),
    max_div_liq_ebitda: float | None = Query(None, description="Dívida líquida / EBITDA máxima"),
    min_margem_graham: float | None = Query(None, description="Desconto mínimo frente ao valor de Graham (%)"),
    min_liquidez_media: float | None = Query(None, description="Liquidez média diária mínima (R$)"),
    somente_com_dados: bool = True,
    ordenar: str = Query("liquidez_media", description="Coluna para ordenar (ver /api/metricas)"),
    ordem: Ordem = "desc",
    limite: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Qualquer coluna numérica aceita `min_<coluna>` / `max_<coluna>`
    (ex.: `min_margem_liquida=10`, `max_ev_ebitda=6`, `min_crescimento_receita=0`)."""
    return _listar("acao", request, busca=busca, categoria=categoria, segmento=segmento,
                   somente_com_dados=somente_com_dados, ordenar=ordenar, ordem=ordem, limite=limite, offset=offset)


@app.get("/api/acoes/{codigo}", tags=["Ações"], summary="Detalhe de uma ação")
def obter_acao(codigo: str = P(..., examples=["PETR4"])):
    return _obter("acao", codigo)


@app.get("/api/{tipo}/valores/{coluna}", tags=["Análises"], summary="Valores distintos de uma coluna de texto")
def valores(tipo: Literal["etfs", "fiis", "acoes"], coluna: str = P(..., examples=["categoria", "segmento", "administrador"])):
    try:
        return repo.valores_distintos(tipo, coluna)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/proventos/{codigo}", tags=["Análises"], summary="Histórico de proventos (ETF ou FII)")
def listar_proventos(codigo: str = P(..., examples=["HGLG11"]), limite: int = Query(120, le=1000)):
    return repo.proventos(codigo, limite)


# ---------------- Análises ----------------


@app.get("/api/metricas", tags=["Análises"], summary="Dicionário de colunas/métricas")
def metricas():
    return repo.dicionario()


@app.get("/api/resumo", tags=["Análises"], summary="Visão geral com estatísticas por categoria")
def resumo():
    return repo.resumo()


@app.get("/api/ranking/{tipo}/{metrica}", tags=["Análises"], summary="Top N por uma métrica")
def ranking(
    request: Request,
    tipo: Literal["etfs", "fiis", "acoes"],
    metrica: str = P(..., examples=["dividend_yield"]),
    n: int = Query(10, ge=1, le=100),
    ordem: Ordem = "desc",
    categoria: str | None = None,
    min_liquidez_media: float | None = Query(None, description="Ignora ativos com pouca liquidez"),
):
    r = _listar(tipo, request, categoria=categoria, ordenar=metrica, ordem=ordem, limite=n,
                campos=["codigo", "ticker", "nome_pregao", "categoria", metrica, "preco", "liquidez_media"])
    return r["itens"]


@app.get("/api/comparar", tags=["Análises"], summary="Compara ativos lado a lado")
def comparar(codigos: str = Query(..., examples=["HGLG11,KNRI11,BOVA11"], description="Separados por vírgula")):
    return repo.comparar([c.strip() for c in codigos.split(",") if c.strip()])


class ConsultaSQL(BaseModel):
    query: str = Field(..., examples=["SELECT segmento, COUNT(*) n, ROUND(AVG(dividend_yield),2) dy FROM fundos WHERE status='ok' GROUP BY segmento ORDER BY dy DESC"])
    limite: int = Field(500, le=5000)


@app.post("/api/sql", tags=["Análises"], summary="SQL livre (somente SELECT)")
def sql(c: ConsultaSQL):
    """Tabelas: `etfs`, `fundos`, `proventos` e a view `ativos` (ETFs + FIIs com colunas comuns)."""
    try:
        return repo.sql_somente_leitura(c.query, c.limite)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/busca", tags=["Análises"], summary="Busca ETFs e FIIs (autocomplete)")
def buscar(q: str = Query(..., min_length=1, examples=["MXRF"]), limite: int = Query(15, le=50)):
    return repo.buscar(q, limite)


# ---------------- Carteira ----------------


class PedidoCarteira(BaseModel):
    tickers: list[str] = Field(..., min_length=2, examples=[["MXRF11", "GARE11", "GOLD11", "AUVP11"]],
                               description="Tickers da B3 ou qualquer ticker do Yahoo (AAPL, BTC-USD)")
    valor: float = Field(1000, gt=0, description="Valor a investir (R$)", examples=[400])
    peso_min: float = Field(0.0, ge=0, le=1, description="Peso mínimo por ativo (0.05 = 5%)")
    peso_max: float = Field(0.35, gt=0, le=1, description="Peso máximo por ativo (0.35 = 35%)")
    filosofia: str | None = Field(None, examples=["value_conservador"], description="Configura os indicadores automaticamente (ver /api/carteira/opcoes)")
    indicadores: list[str] | None = Field(None, examples=[["sharpe", "sortino", "calmar", "renda_risco"]],
                                          description="Objetivos de otimização; se vazio, usa os da filosofia")
    periodo: Literal["1y", "2y", "5y", "10y"] = Field("2y", description="Janela histórica dos retornos")
    taxa_livre_risco: float | None = Field(None, description="Taxa livre de risco anual (0.14 = 14%). Padrão: B3_TAXA_LIVRE_RISCO")


@app.get("/api/carteira/opcoes", tags=["Carteira"], summary="Indicadores e filosofias disponíveis")
def opcoes_carteira():
    return {"indicadores": portfolio.INDICADORES, "filosofias": portfolio.FILOSOFIAS}


@app.post("/api/carteira/otimizar", tags=["Carteira"], summary="Otimiza a carteira e calcula a alocação em cotas")
def otimizar_carteira(p: PedidoCarteira):
    """Retornos diários totais (preço + proventos reinvestidos, ajustados por desdobramentos) no período escolhido.
    Para cada indicador retorna pesos ótimos, métricas e a alocação em **cotas inteiras ao preço atual**,
    além da carteira de pesos iguais, métricas individuais, correlação e fronteira eficiente."""
    try:
        return portfolio.otimizar(**p.model_dump())
    except (ValueError, LookupError) as e:
        raise HTTPException(400, str(e))


# ---------------- Tempo real ----------------


def _yahoo(fn, *a):
    try:
        return fn(*a)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Falha ao consultar Yahoo Finance: {e}")


@app.get("/api/tempo-real/cotacao/{ticker}", tags=["Tempo real"], summary="Cotação e estatísticas ao vivo")
def cotacao(ticker: str = P(..., examples=["HGLG11"])):
    return _yahoo(yahoo.cotacao, ticker)


@app.get("/api/tempo-real/cotacoes", tags=["Tempo real"], summary="Várias cotações de uma vez")
def cotacoes(tickers: str = Query(..., examples=["HGLG11,BOVA11,IVVB11"])):
    out = {}
    for t in [t.strip() for t in tickers.split(",") if t.strip()][:30]:
        try:
            out[t.upper()] = yahoo.cotacao(t)
        except Exception as e:
            out[t.upper()] = {"erro": str(e)}
    return out


@app.get("/api/tempo-real/historico/{ticker}", tags=["Tempo real"], summary="Histórico de preços (OHLCV)")
def historico(
    ticker: str = P(..., examples=["BOVA11"]),
    periodo: Literal["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"] = "6mo",
    intervalo: Literal["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"] = "1d",
):
    return _yahoo(yahoo.historico, ticker, periodo, intervalo)


# ---------------- Atualização ----------------

_job = {"rodando": False, "inicio": None, "fim": None, "erro": None}


def _rodar_job(tipo: str | None):
    _job.update(rodando=True, inicio=datetime.now(timezone.utc).isoformat(), fim=None, erro=None)
    try:
        ingest.carregar_csvs()
        if tipo in (None, "fiis"):
            ingest.aplicar_cvm()
        if tipo in (None, "etfs"):
            ingest.coletar("etfs")
        if tipo in (None, "fiis"):
            ingest.coletar("fundos")
        if tipo in (None, "acoes"):
            ingest.carregar_acoes()
            ingest.coletar("acoes")
    except Exception as e:
        _job["erro"] = str(e)
    finally:
        _job.update(rodando=False, fim=datetime.now(timezone.utc).isoformat())


def _exigir_escrita():
    if SOMENTE_LEITURA:
        raise HTTPException(403, "Instância somente leitura: a base é um snapshot. Rode o ingest localmente para atualizar.")


@app.post("/api/atualizar/{tipo}/{codigo}", tags=["Atualização"], summary="Recoleta um ativo agora")
def atualizar_um(tipo: Literal["etfs", "fiis", "acoes"], codigo: str = P(..., examples=["HGLG"])):
    _exigir_escrita()
    tabela = repo.tabela_de(tipo)
    if not repo.obter(tipo, codigo):
        raise HTTPException(404, f"{codigo} não está na base")
    base = codigo.upper().replace(".SA", "")
    if tabela != "acoes":
        base = base.rstrip("0123456789")
    ingest.atualizar(tabela, base)
    return repo.obter(tipo, base)


@app.post("/api/atualizar", tags=["Atualização"], summary="Recoleta toda a base em background", status_code=202)
def atualizar_tudo(bg: BackgroundTasks, tipo: Literal["etfs", "fiis", "acoes"] | None = None):
    _exigir_escrita()
    if _job["rodando"]:
        raise HTTPException(409, "Atualização já em andamento")
    bg.add_task(lambda: threading.Thread(target=_rodar_job, args=(tipo,), daemon=True).start())
    return {"mensagem": "Atualização iniciada", "status": "/api/atualizar/status"}


@app.get("/api/atualizar/status", tags=["Atualização"], summary="Status da atualização em background")
def status_atualizacao():
    return _job


@app.get("/api/saude", include_in_schema=False)
def saude():
    return {"ok": True, "somente_leitura": SOMENTE_LEITURA}


# ---------------- Dashboard (build do React) ----------------

DIST = ROOT / "frontend" / "dist"


@app.middleware("http")
async def _cache_assets(request: Request, call_next):
    resp = await call_next(request)
    # assets do Vite têm hash no nome: podem ficar em cache (navegador e CDN da Vercel) indefinidamente
    if request.url.path.startswith("/assets/") and resp.status_code == 200:
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{caminho:path}", include_in_schema=False)
    def spa(caminho: str):
        arq = DIST / caminho
        if caminho and arq.is_file():
            return FileResponse(arq)
        # index.html sem cache: um build novo do dashboard aparece sem precisar de hard refresh
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
