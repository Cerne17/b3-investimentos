"""Integração com Yahoo Finance (yfinance)."""
import logging
import math
import re
import os
import threading
import time
import warnings
from datetime import datetime, timedelta, timezone

import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# Sufixos tentados para montar o ticker da B3 a partir do código de 4 letras
SUFIXOS = ("11", "39", "12", "13")


def yahoo_symbol(ticker: str) -> str:
    """Tickers da B3 (ex.: HGLG11, PETR4) recebem .SA; outros (AAPL, ^BVSP, BTC-USD) vão como estão."""
    t = ticker.upper().strip()
    return f"{t}.SA" if re.fullmatch(r"[A-Z0-9]{4}\d{1,2}[A-Z]?", t) else t


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _pct(a, b):
    a, b = _num(a), _num(b)
    return round((a / b - 1) * 100, 2) if a and b else None


_IBOV = {"serie": None}
_IBOV_LOCK = threading.Lock()
TAXA_LIVRE_RISCO = float(os.getenv("B3_TAXA_LIVRE_RISCO", "0.14"))  # a.a., usada no Sharpe


def ibov_retornos() -> pd.Series:
    with _IBOV_LOCK:
        if _IBOV["serie"] is None:
            h = yf.Ticker("^BVSP").history(period="2y")
            s = h["Close"].dropna()
            s.index = s.index.tz_localize(None).normalize()
            _IBOV["serie"] = s.pct_change().dropna()
        return _IBOV["serie"]


def resolve_ticker(codigo: str):
    """Descobre o ticker negociado (BOVA -> BOVA11). Retorna (ticker, yf.Ticker, historico 2a)."""
    for suf in SUFIXOS:
        ticker = f"{codigo}{suf}"
        tk = yf.Ticker(yahoo_symbol(ticker))
        hist = tk.history(period="2y", auto_adjust=False)
        if not hist.empty and hist["Close"].dropna().size:
            return ticker, tk, hist
    return None, None, None


def _desde(serie, ref, dias):
    return serie[serie.index >= ref - timedelta(days=dias)]


SALTO = 1.6  # variação diária acima de +60% / abaixo de -37,5% é tratada como desdobramento/grupamento


def ajustar_splits(hist: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    """O Yahoo às vezes não ajusta desdobramentos/grupamentos da B3. Detecta saltos de preço e
    reescala preços e proventos anteriores para a base atual."""
    hist = hist.copy()
    close = hist["Close"]
    razao = (close / close.shift(1)).dropna()
    eventos = []
    for data, r in razao.items():
        if r > SALTO or r < 1 / SALTO:
            antes = hist.index < data
            hist.loc[antes, ["Open", "High", "Low", "Close"]] *= r
            if "Dividends" in hist:
                hist.loc[antes, "Dividends"] *= r
            eventos.append((data.strftime("%Y-%m-%d"), round(float(1 / r), 4)))
    return hist, eventos


def metricas_preco(hist: pd.DataFrame, preco: float | None) -> dict:
    """Retornos, risco e proventos a partir do histórico diário (2 anos)."""
    hist, splits = ajustar_splits(hist)
    close = hist["Close"].dropna()
    preco = preco or _num(close.iloc[-1])
    ref = close.index[-1]
    janela = lambda d: _desde(close, ref, d)
    inicio = close.index[0]
    # só calcula a janela se o histórico cobre o período inteiro (evita "12m" de ETF recém-lançado)
    cobre = lambda d: inicio <= ref - timedelta(days=d - 7)
    ret = lambda d: _pct(preco, janela(d).iloc[0]) if cobre(d) and len(janela(d)) > 1 else None

    um_ano = janela(365)
    divs = hist["Dividends"] if "Dividends" in hist else pd.Series(dtype=float)
    divs = divs[divs > 0]
    d12 = _desde(divs, ref, 365)
    d24 = divs[(divs.index < ref - timedelta(days=365)) & (divs.index >= ref - timedelta(days=730))]
    prov12, prov_ant = float(d12.sum()), float(d24.sum())

    # retorno total: preço + proventos reinvestidos na data ex
    tot = (um_ano + divs.reindex(um_ano.index).fillna(0)) / um_ano.shift(1)
    tot = tot.dropna() - 1
    ret_total = (float((1 + tot).prod()) - 1) * 100 if len(tot) and cobre(365) else None

    diarios = um_ano.pct_change().dropna()
    vol = float(diarios.std()) * math.sqrt(252) * 100 if len(diarios) > 20 else None
    dd = float((um_ano / um_ano.cummax() - 1).min()) * 100 if len(um_ano) else None

    beta = corr = None
    try:
        ib = ibov_retornos()
        d = diarios.copy()
        d.index = d.index.tz_localize(None).normalize()
        j = pd.concat([d, ib], axis=1, join="inner").dropna()
        if len(j) > 30:
            cov = j.cov().iloc[0, 1]
            beta = cov / j.iloc[:, 1].var()
            corr = j.corr().iloc[0, 1]
    except Exception:
        pass

    max52 = _num(um_ano.max())
    ano = close[close.index.year == ref.year]
    r2 = lambda v, n=2: round(v, n) if v is not None and not (isinstance(v, float) and math.isnan(v)) else None
    return {
        "preco": preco,
        "max_52s": r2(max52),
        "min_52s": r2(_num(um_ano.min())),
        "dist_max_52s": _pct(preco, max52),
        "media_50d": r2(_num(close.tail(50).mean())),
        "media_200d": r2(_num(close.tail(200).mean())) if len(close) >= 200 else None,
        "retorno_1m": ret(30), "retorno_3m": ret(91), "retorno_6m": ret(182),
        "retorno_12m": ret(365), "retorno_24m": ret(730),
        "retorno_ytd": _pct(preco, ano.iloc[0]) if len(ano) else None,
        "retorno_total_12m": r2(ret_total),
        "volatilidade_12m": r2(vol),
        "max_drawdown_12m": r2(dd),
        "sharpe_12m": r2((ret_total / 100 - TAXA_LIVRE_RISCO) / (vol / 100)) if ret_total is not None and vol else None,
        "beta_ibov": r2(beta, 3), "correlacao_ibov": r2(corr, 3),
        "proventos_12m": round(prov12, 4),
        "dividend_yield": round(prov12 / preco * 100, 2) if preco else None,
        "num_proventos_12m": int(len(d12)),
        "crescimento_proventos": _pct(prov12, prov_ant) if prov_ant and cobre(730) else None,
        "ultimo_rendimento": float(divs.iloc[-1]) if len(divs) else None,
        "data_ultimo_rend": divs.index[-1].strftime("%Y-%m-%d") if len(divs) else None,
        "proventos": [(d.strftime("%Y-%m-%d"), float(v)) for d, v in divs.items()],
        "splits": splits,
    }


def coletar_metricas(codigo: str, tipo: str, acoes_por_unit: int = 1) -> dict:
    """Puxa métricas do Yahoo para um ETF ou FII. tipo: 'ETF' | 'FII'."""
    if tipo == "ACAO":  # ações já vêm com o ticker completo (PETR4, TAEE11)
        tk = yf.Ticker(yahoo_symbol(codigo))
        hist = tk.history(period="2y", auto_adjust=False)
        ticker = codigo if not hist.empty and hist["Close"].dropna().size else None
    else:
        ticker, tk, hist = resolve_ticker(codigo)
    if ticker is None:
        return {"status": "sem_dados", "proventos": []}
    try:
        info = tk.info or {}
    except Exception as e:
        info = {"_erro": str(e)}
    if len(info) < 5:  # info vazio = rate limit silencioso; deixa o ingest tentar de novo
        raise RuntimeError(f"Too Many Requests (info vazio para {ticker})")

    dados = metricas_preco(hist, _num(info.get("regularMarketPrice")))
    preco = dados["preco"]
    vol_medio = _num(info.get("averageVolume")) or _num(hist["Volume"].tail(60).mean())
    cotas = _num(info.get("sharesOutstanding"))
    dados.update(
        ticker=ticker,
        nome_yahoo=info.get("longName") or info.get("shortName"),
        volume_medio=vol_medio,
        liquidez_media=round(vol_medio * preco, 2) if vol_medio and preco else None,
        cotas_emitidas=cotas,
        valor_mercado=_num(info.get("marketCap")) or (cotas * preco if cotas and preco else None),
        status="ok",
        atualizado_em=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    if tipo == "ETF":
        dados.update(pl=_num(info.get("trailingPE")), pvp=_num(info.get("priceToBook")))
    elif tipo == "ACAO":
        dados.update(fundamentos_acao(info, preco, acoes_por_unit))
    else:
        vp = _num(info.get("bookValue"))
        pvp = _num(info.get("priceToBook")) or (preco / vp if vp and preco else None)
        dados.update(
            valor_patrimonial=vp,
            pvp=round(pvp, 4) if pvp else None,
            dy_anualizado=round(dados["ultimo_rendimento"] * 12 / preco * 100, 2)
            if dados["ultimo_rendimento"] and preco else None,
        )
    return dados


def fundamentos_acao(info: dict, preco: float | None, por_unit: int = 1) -> dict:
    """Múltiplos, rentabilidade, endividamento e consenso de analistas a partir do quoteSummary do Yahoo.
    Units recebem tratamento próprio (ver abaixo)."""
    g = lambda k: _num(info.get(k))
    pct = lambda k: round(g(k) * 100, 2) if g(k) is not None else None
    lpa, vpa = g("trailingEps"), g("bookValue")
    pl, pvp = g("trailingPE"), g("priceToBook")
    alerta = None
    if por_unit > 1:
        # units: o Yahoo mistura bases (LPA por ação, VP e marketCap inconsistentes). O P/VP da unit é o dado
        # mais estável; o P/L sai da identidade P/L = (P/VP) / ROE, e LPA/VPA por unit a partir dos múltiplos.
        roe = g("returnOnEquity")
        pl = pvp / roe if pvp and roe and roe > 0 else None
        lpa = preco / pl if preco and pl else None
        vpa = preco / pvp if preco and pvp else None
        alerta = f"Unit ({por_unit} ações): P/L e LPA estimados por P/VP ÷ ROE."
    if not pl and preco and lpa and lpa > 0:
        pl = preco / lpa
    if not pvp and preco and vpa and vpa > 0:
        pvp = preco / vpa
    divida, caixa, ebitda = g("totalDebt"), g("totalCash"), g("ebitda")
    div_liq = divida - caixa if divida is not None and caixa is not None else None
    graham = math.sqrt(22.5 * lpa * vpa) if lpa and vpa and lpa > 0 and vpa > 0 else None
    alvo = g("targetMeanPrice")
    acoes, livres = g("sharesOutstanding"), g("floatShares")
    return {
        "setor_yahoo": info.get("sector"),
        "industria_yahoo": info.get("industry"),
        "pl": round(pl, 2) if pl else None,
        "pl_projetado": g("forwardPE") if por_unit == 1 else None,
        "pvp": round(pvp, 4) if pvp else None,
        "psr": g("priceToSalesTrailing12Months"),
        "ev_ebitda": g("enterpriseToEbitda"),
        "ev_receita": g("enterpriseToRevenue"),
        "peg": g("trailingPegRatio") or g("pegRatio"),
        "lpa": lpa,
        "vpa": vpa,
        "earnings_yield": round(lpa / preco * 100, 2) if lpa and preco else None,
        "valor_graham": round(graham, 2) if graham else None,
        "margem_graham": round((graham / preco - 1) * 100, 2) if graham and preco else None,
        "roe": pct("returnOnEquity"),
        "roa": pct("returnOnAssets"),
        "margem_bruta": pct("grossMargins"),
        "margem_ebitda": pct("ebitdaMargins"),
        "margem_operacional": pct("operatingMargins"),
        "margem_liquida": pct("profitMargins"),
        "receita": g("totalRevenue"),
        "ebitda": ebitda,
        "lucro_liquido": g("netIncomeToCommon"),
        "divida_total": divida,
        "caixa": caixa,
        "divida_liquida": div_liq,
        "div_liq_ebitda": round(div_liq / ebitda, 2) if div_liq is not None and ebitda and ebitda > 0 else None,
        "divida_patrimonio": g("debtToEquity"),
        "liquidez_corrente": g("currentRatio"),
        "crescimento_receita": pct("revenueGrowth"),
        "crescimento_lucro": pct("earningsGrowth"),
        "payout": pct("payoutRatio"),
        # o Yahoo às vezes mistura classes (ON+PN) e passa de 100%: nesse caso não é confiável
        "free_float": round(livres / acoes * 100, 2) if livres and acoes and livres <= acoes else None,
        "preco_alvo": alvo,
        "potencial_alvo": round((alvo / preco - 1) * 100, 2) if alvo and preco else None,
        "recomendacao": info.get("recommendationKey") if info.get("recommendationKey") not in (None, "none") else None,
        "num_analistas": int(g("numberOfAnalystOpinions")) if g("numberOfAnalystOpinions") else None,
        "alerta": alerta,
    }


# ---------- tempo real ----------

_CACHE: dict = {}
CACHE_TTL = 30  # segundos — evita estourar o rate limit do Yahoo


def _cache(chave, fn):
    agora = time.time()
    hit = _CACHE.get(chave)
    if hit and agora - hit[0] < CACHE_TTL:
        return hit[1]
    valor = fn()
    _CACHE[chave] = (agora, valor)
    return valor


def cotacao(ticker: str) -> dict:
    return _cache(("cot", ticker.upper()), lambda: _cotacao(ticker))


def _cotacao(ticker: str) -> dict:
    """Cotação e estatísticas em tempo real direto do Yahoo."""
    tk = yf.Ticker(yahoo_symbol(ticker))
    try:
        info = dict(tk.info or {})
    except Exception:
        info = {}
    if not info.get("regularMarketPrice"):
        # fallback: endpoint de gráfico (fast_info) é mais tolerante a rate limit que o quoteSummary
        try:
            fi = tk.fast_info
            preco, ant = _num(fi.last_price), _num(fi.previous_close)
        except Exception:
            preco = ant = None
        if not preco:
            raise LookupError(f"Ticker {ticker} não encontrado no Yahoo Finance")
        info.update(
            regularMarketPrice=preco, regularMarketPreviousClose=ant,
            regularMarketChange=preco - ant if ant else None,
            regularMarketChangePercent=(preco / ant - 1) * 100 if ant else None,
            regularMarketOpen=_num(fi.open), regularMarketDayHigh=_num(fi.day_high), regularMarketDayLow=_num(fi.day_low),
            regularMarketVolume=_num(fi.last_volume), fiftyTwoWeekHigh=_num(fi.year_high), fiftyTwoWeekLow=_num(fi.year_low),
            fiftyDayAverage=_num(fi.fifty_day_average), twoHundredDayAverage=_num(fi.two_hundred_day_average),
            marketCap=_num(getattr(fi, "market_cap", None)), currency=fi.currency,
        )
    campos = {
        "nome": "longName", "moeda": "currency", "preco": "regularMarketPrice",
        "variacao": "regularMarketChange", "variacao_pct": "regularMarketChangePercent",
        "abertura": "regularMarketOpen", "maxima_dia": "regularMarketDayHigh",
        "minima_dia": "regularMarketDayLow", "fechamento_anterior": "regularMarketPreviousClose",
        "volume": "regularMarketVolume", "volume_medio": "averageVolume",
        "max_52s": "fiftyTwoWeekHigh", "min_52s": "fiftyTwoWeekLow",
        "media_50d": "fiftyDayAverage", "media_200d": "twoHundredDayAverage",
        "valor_mercado": "marketCap", "pl": "trailingPE", "pvp": "priceToBook",
        "valor_patrimonial": "bookValue", "dividend_yield_yahoo": "dividendYield",
        "cotas_emitidas": "sharesOutstanding", "estado_mercado": "marketState",
    }
    out = {k: info.get(v) for k, v in campos.items()}
    ts = info.get("regularMarketTime")
    out["ticker"] = ticker.upper().replace(".SA", "")
    out["horario"] = datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else None
    return out


def historico(ticker: str, period: str = "6mo", interval: str = "1d") -> list[dict]:
    return _cache(("hist", ticker.upper(), period, interval), lambda: _historico(ticker, period, interval))


def _historico(ticker: str, period: str, interval: str) -> list[dict]:
    hist = yf.Ticker(yahoo_symbol(ticker)).history(period=period, interval=interval, auto_adjust=False)
    if hist.empty:
        raise LookupError(f"Sem histórico para {ticker}")
    if interval in ("1d", "1wk", "1mo"):
        hist, _ = ajustar_splits(hist)
    return [
        {
            "data": idx.isoformat(),
            "abertura": _num(r["Open"]), "maxima": _num(r["High"]), "minima": _num(r["Low"]),
            "fechamento": _num(r["Close"]), "volume": _num(r["Volume"]),
            "dividendos": _num(r.get("Dividends", 0)) or 0.0,
        }
        for idx, r in hist.iterrows()
    ]
