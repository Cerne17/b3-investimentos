"""Comparador de FIIs: indicadores atuais lado a lado e séries históricas (P/VP, DY 12m, vacância, cotistas)."""
import re

import pandas as pd

from . import repository as repo
from .db import connect
from .yahoo import history

CAMPOS = ("nome_pregao", "segmento", "categoria", "preco", "pvp", "dividend_yield", "liquidez_media", "cotistas",
          "patrimonio_liquido", "taxa_adm_anual", "alavancagem", "pct_imoveis", "pct_papel", "rentab_patrimonial_12m",
          "num_proventos_12m", "valor_patrimonial")


def _mensal(codigo: str) -> pd.DataFrame:
    with connect(readonly=True) as conn:
        rows = conn.execute("SELECT mes, vp_cota, dy_mes, cotistas, rent_patrimonial FROM fii_mensal WHERE codigo=? ORDER BY mes", [codigo]).fetchall()
    return pd.DataFrame([dict(r) for r in rows]).set_index("mes") if rows else pd.DataFrame()


def _trimestral(codigo: str) -> list[dict]:
    with connect(readonly=True) as conn:
        rows = conn.execute("SELECT data, vacancia, inadimplencia, imoveis FROM fii_trimestral WHERE codigo=? ORDER BY data", [codigo]).fetchall()
    return [dict(r) for r in rows]


def comparar(tickers: list[str]) -> dict:
    fiis = []
    for t in tickers[:6]:
        t = t.strip().upper().replace(".SA", "")
        codigo = re.sub(r"\d+$", "", t)
        base = repo.obter("fii", codigo) or {}
        if not base:
            fiis.append({"ticker": t, "erro": "FII não encontrado na base"})
            continue
        ticker = base.get("ticker") or f"{codigo}11"
        mensal, tri = _mensal(codigo), _trimestral(codigo)
        serie = {}
        try:
            h = history(ticker, "5y")
            close = h["Close"].dropna()
            idx = close.index.tz_localize(None) if close.index.tz is not None else close.index
            close.index = idx
            divs = h["Dividends"].reindex(h.index).fillna(0)
            divs.index = idx
            fim_mes = close.resample("ME").last()
            dy12 = divs.resample("ME").sum().rolling(12).sum() / fim_mes * 100
            # VP/cota do mês (ou o último publicado: o informe da CVM sai com ~1 mês de atraso)
            vps = mensal["vp_cota"].dropna() if not mensal.empty else pd.Series(dtype=float)
            for d, p in fim_mes.items():
                mes = d.strftime("%Y-%m")
                anteriores = vps[vps.index <= mes]
                vp = float(anteriores.iloc[-1]) if len(anteriores) and anteriores.index[-1] >= (d - pd.DateOffset(months=3)).strftime("%Y-%m") else None
                serie[mes] = {"preco": round(float(p), 2), "pvp": round(float(p) / vp, 3) if vp else None,
                              "dy_12m": None if pd.isna(dy12.get(d)) else round(float(dy12[d]), 2)}
        except Exception:
            pass
        for mes, r in (mensal.iterrows() if not mensal.empty else []):
            s = serie.setdefault(mes, {})
            s.update(vp_cota=None if pd.isna(r["vp_cota"]) else round(float(r["vp_cota"]), 2),
                     cotistas=None if pd.isna(r["cotistas"]) else int(r["cotistas"]),
                     dy_mes_cvm=None if pd.isna(r["dy_mes"]) else round(float(r["dy_mes"]), 3))
        ultimo = tri[-1] if tri else {}
        fiis.append({
            "ticker": ticker, "codigo": codigo,
            **{k: base.get(k) for k in CAMPOS},
            "vacancia": ultimo.get("vacancia"), "inadimplencia": ultimo.get("inadimplencia"), "imoveis": ultimo.get("imoveis"),
            "data_trimestral": ultimo.get("data"),
            "historico": [{"mes": m, **v} for m, v in sorted(serie.items()) if m >= "2021-01"],
            "trimestral": tri,
        })
    return {"fiis": fiis}
