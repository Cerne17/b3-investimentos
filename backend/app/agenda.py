"""Agenda de proventos estimada para os próximos 12 meses, a partir da regularidade dos últimos pagamentos.

Para cada ativo, olha as datas ex dos últimos 24 meses:
* mensal (10 ou mais nos últimos 12 meses): repete todo mês, no mesmo dia, com a média dos últimos 3 valores;
* trimestral/semestral/anual regulares: repete no mesmo intervalo, com o último valor;
* irregular (ações que pagam em meses variados): repete os meses do último ano, com os valores daquele ano.
É uma estimativa pela regularidade: valores e datas reais dependem dos anúncios de cada empresa ou fundo.
"""
from datetime import date

import pandas as pd

from . import rendafixa
from .yahoo import eh_cripto, history


def _datas_ex(ticker: str) -> pd.Series:
    h = history(ticker, "2y")
    if h.empty or "Dividends" not in h:
        return pd.Series(dtype=float)
    d = h["Dividends"]
    d = d[d > 0]
    idx = d.index.tz_localize(None) if d.index.tz is not None else d.index
    return pd.Series(d.to_numpy(), index=idx.normalize())


def _projetar(divs: pd.Series, hoje: pd.Timestamp) -> tuple[str, list[tuple[pd.Timestamp, float]]]:
    um_ano = divs[divs.index > hoje - pd.DateOffset(years=1)]
    if um_ano.empty:
        return "sem pagamentos no último ano", []
    fim = hoje + pd.DateOffset(years=1)
    n = len(um_ano)
    ultimo = um_ano.index[-1]
    if n >= 10:
        passo, valor, nome = 1, float(um_ano.iloc[-3:].mean()), "mensal"
    elif n in (3, 4, 5) and _regular(um_ano, 3):
        passo, valor, nome = 3, float(um_ano.iloc[-1]), "trimestral"
    elif n == 2 and _regular(um_ano, 6):
        passo, valor, nome = 6, float(um_ano.iloc[-1]), "semestral"
    elif n == 1:
        passo, valor, nome = 12, float(um_ano.iloc[-1]), "anual"
    else:  # irregular: repete o último ano, deslocado em 12 meses
        futuras = [(d + pd.DateOffset(years=1), float(v)) for d, v in um_ano.items()]
        return "irregular (repete o último ano)", [(d, v) for d, v in futuras if hoje < d <= fim]
    out, d = [], ultimo
    while True:
        d = d + pd.DateOffset(months=passo)
        if d > fim:
            break
        if d > hoje:
            out.append((d, valor))
    return nome, out


def _regular(s: pd.Series, meses: int) -> bool:
    """Intervalos entre pagamentos perto de `meses` (tolerância de ~3 semanas)."""
    dif = pd.Series(s.index).diff().dropna().dt.days
    return bool(len(dif)) and bool((abs(dif - meses * 30.4) <= 21).all())


def agenda(posicoes: list[dict]) -> dict:
    hoje = pd.Timestamp(date.today())
    meses = [(hoje + pd.DateOffset(months=i)).strftime("%Y-%m") for i in range(12)]  # mês atual + 11
    porMes = {m: {"mes": m, "total": 0.0, "itens": []} for m in meses}
    ativos, avisos = [], []
    for p in posicoes:
        t, q = str(p["ticker"]).upper(), float(p.get("quantidade") or 0)
        if q <= 0 or eh_cripto(t) or (rendafixa.eh_renda_fixa(t) and not rendafixa.eh_tesouro(t)):
            continue
        try:
            divs = _datas_ex(t)
        except Exception as e:
            avisos.append(f"{t}: {e}")
            continue
        padrao, futuras = _projetar(divs, hoje)
        total = 0.0
        for d, v in futuras:
            m = d.strftime("%Y-%m")
            if m not in porMes:
                continue
            porMes[m]["itens"].append({"ticker": t, "data_ex": d.strftime("%Y-%m-%d"), "por_cota": round(v, 6), "valor": round(v * q, 2)})
            porMes[m]["total"] += v * q
            total += v * q
        ativos.append({"ticker": t, "padrao": padrao, "pagamentos": len(futuras), "total_12m": round(total, 2)})
    for m in porMes.values():
        m["total"] = round(m["total"], 2)
        m["itens"].sort(key=lambda i: i["data_ex"])
    return {"meses": [porMes[m] for m in meses], "ativos": ativos,
            "total_12m": round(sum(a["total_12m"] for a in ativos), 2), "avisos": avisos}
