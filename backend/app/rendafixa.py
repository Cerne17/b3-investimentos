"""Renda fixa como ativo: índices de retorno acumulado a partir das séries do Banco Central (SGS).

Tickers sintéticos (o "preço" é o índice acumulado desde 03/01/2005 = 1,0; comprar R$ 1.000 num dia = 1.000 ÷ índice
daquele dia em "cotas"):
* CDI        — 100% do CDI (Tesouro Selic, CDB/LCI de liquidez diária); CDI-110 = 110% do CDI
* SELIC      — taxa Selic diária (Tesouro Selic)
* IPCA+6     — IPCA + 6% a.a. (Tesouro IPCA+ levado ao vencimento: sem marcação a mercado); aceita IPCA+6.5
* PRE-13     — prefixado de 13% a.a. (levado ao vencimento)

Dias úteis = datas publicadas da série do CDI. O IPCA é mensal: distribuído pelos dias úteis do mês; meses ainda sem
IPCA publicado usam a média mensal dos últimos 12 meses.
"""
import re
import threading
import time
from datetime import date, timedelta

import httpx
import numpy as np
import pandas as pd

PADRAO = re.compile(r"^(CDI(?:-(\d+(?:[.,]\d+)?))?|SELIC|IPCA\+(\d+(?:[.,]\d+)?)|PRE-(\d+(?:[.,]\d+)?))$")
INICIO = date(2005, 1, 3)
SERIES = {"cdi": 12, "selic": 11, "ipca": 433}  # % ao dia (CDI, Selic) e % no mês (IPCA)
TTL = 6 * 3600
_cache: dict = {}
_trava = threading.Lock()


def eh_renda_fixa(ticker: str) -> bool:
    return bool(PADRAO.match(ticker.upper().strip()))


def _num(s: str | None) -> float | None:
    return float(s.replace(",", ".")) if s else None


def _baixar(cli: httpx.Client, nome: str, ini: date, fim: date) -> list[dict]:
    """Baixa um trecho da série do SGS em janelas de 5 anos (a API recusa ou demora em janelas longas)."""
    out = []
    while ini <= fim:
        ate = min(date(ini.year + 4, 12, 31), fim)
        url = (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{SERIES[nome]}/dados"
               f"?formato=json&dataInicial={ini:%d/%m/%Y}&dataFinal={ate:%d/%m/%Y}")
        for tentativa in range(3):
            try:
                r = cli.get(url)
                if r.status_code == 200:
                    out += r.json()
                    break
                if 400 <= r.status_code < 500:  # sem dados no intervalo (ex.: IPCA do mês ainda não saiu)
                    break
            except (httpx.HTTPError, ValueError):
                if tentativa == 2:
                    raise
            time.sleep(1 + tentativa)
        ini = ate + timedelta(days=1)
    return out


def _do_banco(nome: str) -> pd.Series:
    try:
        from .db import connect
        with connect(readonly=True) as conn:
            rows = conn.execute("SELECT data, valor FROM series_bcb WHERE serie=? ORDER BY data", [nome]).fetchall()
        return pd.Series({pd.Timestamp(r["data"]): r["valor"] for r in rows}, dtype=float)
    except Exception:
        return pd.Series(dtype=float)


def _sgs(nome: str) -> pd.Series:
    """Série do SGS em %, indexada pela data: o snapshot da base (ingestão) mais o trecho recente baixado agora.
    Guarda por 6 horas; se o Banco Central não responder, fica com o snapshot."""
    with _trava:
        hit = _cache.get(nome)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
        base = _do_banco(nome)
        cab = {"User-Agent": "Mozilla/5.0 (b3-investimentos)", "Accept": "application/json"}
        try:
            if len(base) and (date.today() - base.index[-1].date()).days < 60:
                # com snapshot recente basta completar: o endpoint "últimos N" é rápido (o de intervalo chega a 20 s)
                with httpx.Client(timeout=10, headers=cab) as cli:
                    r = cli.get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{SERIES[nome]}/dados/ultimos/60?formato=json")
                    r.raise_for_status()
                    novos = r.json()
            else:
                ini = (base.index[-1].date() + timedelta(days=1)) if len(base) else INICIO
                with httpx.Client(timeout=30, headers=cab) as cli:
                    novos = _baixar(cli, nome, ini, date.today())
        except (httpx.HTTPError, ValueError):  # fora do ar, lento ou página de erro em vez de JSON
            if not len(base):
                raise LookupError("Banco Central fora do ar e sem snapshot da série na base")
            novos = []
        extra = pd.Series({pd.Timestamp(pd.to_datetime(p["data"], dayfirst=True)): float(p["valor"]) for p in novos}, dtype=float)
        s = pd.concat([base, extra]).sort_index()
        s = s[~s.index.duplicated(keep="last")]
        _cache[nome] = (time.time(), s)
        return s


def salvar() -> dict:
    """Ingestão: grava as séries completas na base (snapshot usado em produção, onde o disco é somente leitura)."""
    from .db import connect
    _cache.clear()
    out = {}
    with connect() as conn:
        for nome in SERIES:
            s = _sgs(nome)
            conn.executemany("INSERT OR REPLACE INTO series_bcb (serie, data, valor) VALUES (?, ?, ?)",
                             [(nome, d.strftime("%Y-%m-%d"), float(v)) for d, v in s.items()])
            out[nome] = len(s)
    return out


def _fator_ipca(dias: pd.DatetimeIndex) -> np.ndarray:
    """Fator diário do IPCA: inflação do mês distribuída igualmente pelos dias úteis do mês."""
    ipca = _sgs("ipca") / 100
    media = float((1 + ipca.iloc[-12:]).prod() ** (1 / 12) - 1)  # meses sem IPCA publicado
    mes = dias.to_period("M")
    mensal = pd.Series(ipca.to_numpy(), index=ipca.index.to_period("M"))
    taxa = mes.map(lambda m: mensal.get(m, media)).to_numpy(dtype=float)
    # dias úteis do mês: os da série quando o mês já acabou; no mês corrente, estima pelo calendário (seg-sex)
    contagem = pd.Series(1, index=mes).groupby(level=0).transform("size").to_numpy()
    hoje = pd.Timestamp(date.today()).to_period("M")
    cheio = np.array([len(pd.bdate_range(m.start_time, m.end_time)) for m in mes])
    du = np.where(mes == hoje, cheio, contagem)
    return (1 + taxa) ** (1 / du)


def indice(ticker: str) -> pd.Series:
    """Índice acumulado diário (base 1,0 no primeiro dia útil de 2005) do título de renda fixa."""
    t = ticker.upper().strip()
    chave = ("indice", t)
    hit = _cache.get(chave)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    m = PADRAO.match(t)
    if not m:
        raise LookupError(f"{ticker} não é um título de renda fixa conhecido")
    cdi = _sgs("cdi") / 100
    dias = cdi.index
    if t == "SELIC":
        fator = 1 + (_sgs("selic") / 100).reindex(dias).ffill().to_numpy()
    elif t.startswith("CDI"):
        pct = (_num(m.group(2)) or 100) / 100
        fator = 1 + cdi.to_numpy() * pct
    elif t.startswith("IPCA+"):
        fator = _fator_ipca(dias) * (1 + _num(m.group(3)) / 100) ** (1 / 252)
    else:
        fator = np.full(len(dias), (1 + _num(m.group(4)) / 100) ** (1 / 252))
    # o fator de um dia rende do fechamento anterior até ele: o primeiro dia é a base
    s = pd.Series(np.concatenate([[1.0], np.cumprod(fator[1:])]), index=dias, name=t)
    _cache[chave] = (time.time(), s)
    return s


PERIODOS = {"1d": 5, "5d": 7, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827, "10y": 3653}


def history(ticker: str, period: str = "2y") -> pd.DataFrame:
    """Mesmo formato do histórico do Yahoo (OHLC = índice, sem volume nem proventos), um ponto por dia útil."""
    s = indice(ticker)
    if period == "ytd":
        s = s[s.index >= pd.Timestamp(date.today().year, 1, 1)]
    elif period in PERIODOS:
        s = s[s.index >= s.index[-1] - pd.Timedelta(days=PERIODOS[period])]
    idx = s.index.tz_localize("America/Sao_Paulo")
    v = s.to_numpy()
    return pd.DataFrame({"Open": v, "High": v, "Low": v, "Close": v, "Volume": 0.0, "Dividends": 0.0}, index=idx)


def taxa_anual(ticker: str) -> float:
    """Rentabilidade anualizada dos últimos 12 meses (%)."""
    s = indice(ticker)
    um_ano = s[s.index >= s.index[-1] - pd.Timedelta(days=365)]
    return round((float(um_ano.iloc[-1] / um_ano.iloc[0]) - 1) * 100, 2)


def nome(ticker: str) -> str:
    t = ticker.upper().strip()
    m = PADRAO.match(t)
    if t == "SELIC":
        return "Tesouro Selic (taxa Selic)"
    if t.startswith("CDI"):
        pct = _num(m.group(2)) or 100
        return f"{pct:g}% do CDI" + (" (Tesouro Selic, CDB liquidez diária)" if pct == 100 else " (CDB/LCI)")
    if t.startswith("IPCA+"):
        return f"IPCA + {_num(m.group(3)):g}% a.a. (Tesouro IPCA+ no vencimento)"
    return f"Prefixado {_num(m.group(4)):g}% a.a. (no vencimento)"


def cotacao(ticker: str) -> dict:
    s = indice(ticker)
    preco, ant = float(s.iloc[-1]), float(s.iloc[-2])
    return {
        "ticker": ticker.upper(), "nome": nome(ticker), "moeda": "BRL", "preco": preco,
        "fechamento_anterior": ant, "variacao": preco - ant, "variacao_pct": (preco / ant - 1) * 100,
        "abertura": ant, "maxima_dia": preco, "minima_dia": ant, "volume": None, "estado_mercado": "REGULAR",
        "horario": s.index[-1].strftime("%Y-%m-%dT00:00:00-03:00"), "taxa_12m": taxa_anual(ticker), "renda_fixa": True,
    }


SUGESTOES = ["CDI", "CDI-110", "SELIC", "IPCA+6", "IPCA+7", "PRE-13", "PRE-14"]
PALAVRAS = ("cdi", "selic", "ipca", "pre", "tesouro", "cdb", "lci", "lca", "renda fixa", "rf")


def buscar(q: str) -> list[dict]:
    """Sugestões de renda fixa para o autocomplete (o usuário pode digitar outras taxas: IPCA+6.8, CDI-95...)."""
    ql, qu = q.lower().strip(), q.upper().strip()
    digitado = eh_renda_fixa(qu)
    if not digitado and (len(ql) < 2 or not any(p.startswith(ql) or ql.startswith(p) for p in PALAVRAS)):
        return []
    alvo = [t for t in SUGESTOES if t.startswith(qu)] or SUGESTOES
    if digitado and qu not in alvo:
        alvo = [qu] + alvo
    out = []
    for t in alvo:
        try:
            preco = float(indice(t).iloc[-1])
        except Exception:
            preco = None
        out.append({"tipo": "RF", "codigo": t, "ticker": t, "nome_pregao": nome(t), "categoria": "Renda fixa",
                    "preco": preco, "status": "ok" if preco else "sem_dados"})
    return out
