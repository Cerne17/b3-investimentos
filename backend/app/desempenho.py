"""Desempenho real de uma carteira a partir das operações (compras e vendas com data).

* As operações estão em valores nominais (como negociados). Os preços do Yahoo vêm ajustados por desdobramentos,
  então cada operação anterior a um desdobramento/grupamento é convertida para a base atual (quantidade x fator,
  preço ÷ fator) — não é preciso lançar os desdobramentos.
* Proventos: na data ex, quantidade que o investidor tinha no fim do pregão anterior x valor por cota. Contam como
  dinheiro recebido (não reinvestido).
* Rentabilidade ponderada no tempo (TWR): neutraliza o efeito dos aportes e vendas — é a que se compara com índices.
  Taxa interna de retorno (TIR): a rentabilidade anual do seu dinheiro, considerando quando ele entrou e saiu.
* Benchmarks: o mesmo período em cada índice e "se os mesmos aportes e vendas tivessem ido para o índice".
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.optimize import brentq

from . import rendafixa
from .yahoo import ajustar_splits, eh_cripto, history

BENCHMARKS = {"IBOV": "^BVSP", "CDI": "CDI", "IFIX": "XFIX11", "S&P 500": "IVVB11"}
PERIODOS = [(31, "1mo"), (92, "3mo"), (183, "6mo"), (366, "1y"), (731, "2y"), (1827, "5y"), (3653, "10y")]


def _periodo(inicio: date) -> str:
    dias = (date.today() - inicio).days + 10
    return next((p for d, p in PERIODOS if dias <= d), "max")


def _dia(s: pd.Series) -> pd.Series:
    idx = s.index.tz_localize(None) if s.index.tz is not None else s.index
    s = s.copy()
    s.index = idx.normalize()
    return s[~s.index.duplicated(keep="last")]


def _serie(ticker: str, periodo: str) -> tuple[pd.Series, pd.Series, list[tuple[pd.Timestamp, float]]]:
    """Fechamento e proventos por cota na base atual (ajustados por desdobramento) e os eventos de desdobramento."""
    hist = history(ticker, periodo)
    if hist.empty:
        raise LookupError(f"Sem histórico para {ticker}")
    eventos = []
    if not eh_cripto(ticker) and not rendafixa.eh_renda_fixa(ticker):
        if "Stock Splits" in hist:  # desdobramentos que o Yahoo já aplicou aos preços
            sp = hist["Stock Splits"]
            eventos += [(d, float(r)) for d, r in sp[sp > 0].items()]
        hist, extras = ajustar_splits(hist)  # e os que ele deixou passar (saltos de preço)
        eventos += [(pd.Timestamp(d, tz=hist.index.tz), f) for d, f in extras]
    close = _dia(hist["Close"].dropna())
    divs = _dia(hist["Dividends"]) if "Dividends" in hist else close * 0
    eventos = [(pd.Timestamp(d).tz_localize(None).normalize() if pd.Timestamp(d).tzinfo else pd.Timestamp(d).normalize(), f)
               for d, f in eventos if f and f != 1]
    return close, divs.reindex(close.index).fillna(0), eventos


def _no_calendario(divs: pd.Series, datas: pd.DatetimeIndex) -> pd.Series:
    """Proventos por cota levados ao calendário da carteira (data ex fora dele cai no pregão seguinte)."""
    divs = divs[(divs > 0) & (divs.index >= datas[0]) & (divs.index <= datas[-1])]
    if divs.empty:
        return pd.Series(0.0, index=datas)
    alvo = datas[datas.searchsorted(divs.index)]
    return pd.Series(divs.to_numpy(), index=alvo).groupby(level=0).sum().reindex(datas).fillna(0)


def _fator(eventos, data: pd.Timestamp) -> float:
    return float(np.prod([f for d, f in eventos if d > data])) if eventos else 1.0


def preco_em(ticker: str, data: date) -> dict:
    """Preço nominal (como negociado naquele dia) no fechamento da data ou do último pregão antes dela."""
    close, _, eventos = _serie(ticker, _periodo(data))
    alvo = pd.Timestamp(data)
    antes = close[close.index <= alvo]
    if antes.empty:
        raise LookupError(f"{ticker} não tem preço em {data:%d/%m/%Y} (histórico começa em {close.index[0]:%d/%m/%Y})")
    d = antes.index[-1]
    return {"ticker": ticker.upper(), "data": d.strftime("%Y-%m-%d"), "preco": round(float(antes.iloc[-1]) * _fator(eventos, d), 6)}


def _tir(fluxos: list[tuple[pd.Timestamp, float]]) -> float | None:
    if not fluxos or not any(v > 0 for _, v in fluxos) or not any(v < 0 for _, v in fluxos):
        return None
    t0 = fluxos[0][0]
    anos = np.array([(d - t0).days / 365 for d, _ in fluxos])
    v = np.array([x for _, x in fluxos])
    f = lambda r: float(np.sum(v / (1 + r) ** anos))
    try:
        return brentq(f, -0.99, 20)
    except ValueError:
        return None


def _custo_medio_e_ir(tx: list[dict]) -> tuple[list[dict], dict]:
    """Posições atuais (base atual, custo médio) e apuração mensal do IR sobre vendas (pessoa física, operações
    comuns): ações com isenção para vendas de até R$ 20 mil no mês; ETFs e BDRs 15% sem isenção; FIIs 20%; cripto 15%
    com isenção até R$ 35 mil/mês. Prejuízos compensam lucros futuros da mesma categoria (ações/ETFs/BDRs juntos, FIIs
    à parte, cripto à parte). Renda fixa e Tesouro têm IR retido na fonte e ficam fora. DARF abaixo de R$ 10 acumula."""
    from . import impostos
    pos, vendas_mes = {}, {}
    for x in sorted(tx, key=lambda x: x["data"]):
        p = pos.setdefault(x["ticker"], {"q": 0.0, "custo": 0.0})
        if x["sinal"] > 0:
            p["q"] += x["q"]
            p["custo"] += x["q"] * x["p"]
            continue
        q = min(x["q"], p["q"])
        if q <= 0:
            continue
        medio = p["custo"] / p["q"] if p["q"] else 0.0
        p["custo"] -= medio * q
        p["q"] -= q
        if x["evento"]:  # grupamento: menos cotas, mesmo custo total
            p["custo"] += medio * q
            continue
        classe = impostos.classe(x["ticker"])
        if classe == "RF":
            continue
        m = vendas_mes.setdefault(x["data"].strftime("%Y-%m"), {})
        v = m.setdefault(classe, {"vendas": 0.0, "lucro": 0.0})
        v["vendas"] += q * x["p"]
        v["lucro"] += (x["p"] - medio) * q
    posicoes = [{"ticker": t, "quantidade": round(p["q"], 8), "preco_medio": round(p["custo"] / p["q"], 6)}
                for t, p in pos.items() if p["q"] > 1e-9]

    CATEG = {"ACAO": "comum", "ETF": "comum", "EXTERIOR": "comum", "FII": "fii", "CRIPTO": "cripto"}
    ALIQ = {"comum": 0.15, "fii": 0.20, "cripto": 0.15}
    prejuizo = {"comum": 0.0, "fii": 0.0, "cripto": 0.0}
    meses, pendente = [], 0.0
    for mes in sorted(vendas_mes):
        linhas = vendas_mes[mes]
        vendas_acoes = linhas.get("ACAO", {}).get("vendas", 0.0)
        vendas_cripto = linhas.get("CRIPTO", {}).get("vendas", 0.0)
        base = {"comum": 0.0, "fii": 0.0, "cripto": 0.0}
        isento = 0.0
        for classe, v in linhas.items():
            cat, lucro = CATEG.get(classe, "comum"), v["lucro"]
            if lucro > 0 and ((classe == "ACAO" and vendas_acoes <= 20_000) or (classe == "CRIPTO" and vendas_cripto <= 35_000)):
                isento += lucro  # lucro isento não consome prejuízo
                continue
            base[cat] += lucro
        imposto = 0.0
        for cat, lucro in base.items():
            if lucro >= 0:
                usado = min(prejuizo[cat], lucro)  # compensa prejuízo acumulado da mesma categoria
                prejuizo[cat] -= usado
                imposto += (lucro - usado) * ALIQ[cat]
            else:
                prejuizo[cat] -= lucro
        devido = imposto + pendente
        darf = devido if devido >= 10 else 0.0
        pendente = 0.0 if darf else devido
        meses.append({
            "mes": mes,
            "vendas": {impostos.NOMES[c]: round(v["vendas"], 2) for c, v in linhas.items()},
            "lucro": {impostos.NOMES[c]: round(v["lucro"], 2) for c, v in linhas.items()},
            "isento": round(isento, 2), "imposto": round(imposto, 2), "darf": round(darf, 2),
            "prejuizo_acumulado": {k: round(v, 2) for k, v in prejuizo.items()},
        })
    return posicoes, {"meses": meses, "total_darf": round(sum(m["darf"] for m in meses), 2), "a_pagar_acumulado": round(pendente, 2)}


def desempenho(transacoes: list[dict], benchmarks: list[str] | None = None) -> dict:
    if not transacoes:
        raise ValueError("Nenhuma operação: registre compras (e vendas) com data.")
    tx = []
    for t in transacoes:
        tipo = str(t.get("tipo", "compra")).lower()
        if tipo not in ("compra", "venda"):
            raise ValueError(f"tipo de operação desconhecido: {tipo}")
        q, p = float(t["quantidade"]), float(t.get("preco") or 0)
        if q <= 0:
            continue
        evento = (t.get("evento") or None) and str(t["evento"]).lower()
        tx.append({"data": pd.Timestamp(t["data"]).normalize(), "ticker": str(t["ticker"]).upper().replace(".SA", ""),
                   "sinal": 1 if tipo == "compra" else -1, "q": q, "p": p, "evento": evento})
    if not tx:
        raise ValueError("Nenhuma operação com quantidade positiva.")
    tx.sort(key=lambda x: x["data"])
    inicio = tx[0]["data"]
    periodo = _periodo(inicio.date())
    tickers = list(dict.fromkeys(x["ticker"] for x in tx))

    precos, divs, eventos, avisos = {}, {}, {}, []
    for t in tickers:
        try:
            precos[t], divs[t], eventos[t] = _serie(t, periodo)
        except Exception as e:
            avisos.append(f"{t}: sem histórico ({e}); fica de fora do cálculo")
    tx = [x for x in tx if x["ticker"] in precos]
    if not tx:
        raise LookupError("Nenhum ativo das operações tem histórico.")
    # desdobramento/grupamento/bonificação lançados (ex.: vindos do extrato da B3): se o Yahoo já registra o evento
    # perto da data, os preços já estão ajustados e a conversão para a base atual já cria as cotas novas — descarta
    sem_dup = []
    for x in tx:
        if x["evento"] and any(abs((d - x["data"]).days) <= 20 for d, _ in eventos[x["ticker"]]):
            avisos.append(f"{x['ticker']}: {x['evento']} de {x['data']:%d/%m/%Y} já está nos preços do Yahoo; lançamento ignorado")
            continue
        sem_dup.append(x)
    tx = sem_dup
    for x in tx:  # operações anteriores a desdobramentos → base atual
        f = _fator(eventos[x["ticker"]], x["data"])
        x["q"], x["p"] = x["q"] * f, x["p"] / f

    ativos = [t for t in tickers if t in precos]
    bolsa = [precos[t].index for t in ativos if not eh_cripto(t)] or [precos[t].index for t in ativos]
    datas = pd.DatetimeIndex(sorted(set().union(*bolsa) | {x["data"] for x in tx}))
    datas = datas[datas >= inicio]
    P = pd.DataFrame({t: precos[t].reindex(precos[t].index.union(datas)).ffill().reindex(datas) for t in ativos})
    D = pd.DataFrame({t: _no_calendario(divs[t], datas) for t in ativos})
    # na compra o preço que vale é o da operação até existir fechamento
    P = P.fillna(pd.DataFrame({t: [next((x["p"] for x in tx if x["ticker"] == t), np.nan)] * len(datas) for t in ativos}, index=datas))

    qtd = {t: 0.0 for t in ativos}
    por_dia = {}
    for x in tx:
        por_dia.setdefault(x["data"], []).append(x)
    valor, investido, prov_acum, twr = [], [], [], []
    recebidos, fluxos = [], []
    v_ant, inv, pacum, indice = 0.0, 0.0, 0.0, 1.0
    for i, d in enumerate(datas):
        prov = 0.0
        for t in ativos:  # data ex: vale a posição do fim do pregão anterior
            dv = float(D.at[d, t])
            if dv > 0 and qtd[t] > 0:
                prov += float(dv) * qtd[t]
                recebidos.append({"data": d.strftime("%Y-%m-%d"), "ticker": t, "por_cota": round(float(dv), 6),
                                  "quantidade": round(qtd[t], 8), "valor": round(float(dv * qtd[t]), 2)})
        cf = 0.0
        for x in por_dia.get(d, []):
            qtd[x["ticker"]] = max(0.0, qtd[x["ticker"]] + x["sinal"] * x["q"])
            if x["evento"]:  # evento societário mexe na quantidade, não no dinheiro
                continue
            cf += x["sinal"] * x["q"] * x["p"]
            fluxos.append((d, -x["sinal"] * x["q"] * x["p"]))
        if prov:
            fluxos.append((d, prov))
        v = float(sum(qtd[t] * float(P.at[d, t]) for t in ativos if qtd[t] > 0))
        base = v_ant + cf
        if base > 1e-9:
            indice *= (v + prov) / base
        inv += cf
        pacum += prov
        valor.append(v); investido.append(inv); prov_acum.append(pacum); twr.append(indice)
        v_ant = v
    fluxos.append((datas[-1], valor[-1]))
    fluxos.sort(key=lambda f: f[0])
    dias = max(1, (datas[-1] - datas[0]).days)
    tir = _tir(fluxos)

    bench = {}
    for nome in (benchmarks if benchmarks is not None else list(BENCHMARKS)):
        simbolo = BENCHMARKS.get(nome, nome)
        try:
            h = history(simbolo, periodo)
            s = _dia(h["Close"].dropna())
            if "Dividends" in h and simbolo != "^BVSP":  # retorno total (o Ibovespa já reinveste proventos)
                dv = _dia(h["Dividends"]).reindex(s.index).fillna(0)
                s = ((s + dv) / s.shift(1)).fillna(1).cumprod() * s.iloc[0]
            s = s.reindex(s.index.union(datas)).ffill().reindex(datas)
            if s.isna().all():
                continue
            s = s.bfill()
            r = (s / s.shift(1)).fillna(1).to_numpy(dtype=float)
            vb, serie_vb = 0.0, []
            for i, d in enumerate(datas):
                cf = sum(x["sinal"] * x["q"] * x["p"] for x in por_dia.get(d, []))
                vb = vb * r[i] + cf
                serie_vb.append(vb)
            ret = float(s.iloc[-1] / s.iloc[0] - 1) * 100
            bench[nome] = {"simbolo": simbolo, "twr": np.round((s / s.iloc[0]).to_numpy() * 100 - 100, 3).tolist(),
                           "retorno": round(ret, 2), "mesmos_aportes": np.round(serie_vb, 2).tolist(),
                           "valor_final_mesmos_aportes": round(float(serie_vb[-1]), 2)}
        except Exception as e:
            avisos.append(f"benchmark {nome}: {e}")

    v_fim, inv_fim = valor[-1], investido[-1]
    compras = sum(x["q"] * x["p"] for x in tx if x["sinal"] > 0 and not x["evento"])
    vendas = sum(x["q"] * x["p"] for x in tx if x["sinal"] < 0 and not x["evento"])
    posicoes, ir_mensal = _custo_medio_e_ir(tx)
    return {
        "inicio": datas[0].strftime("%Y-%m-%d"), "fim": datas[-1].strftime("%Y-%m-%d"),
        "datas": [d.strftime("%Y-%m-%d") for d in datas],
        "valor": np.round(valor, 2).tolist(), "investido": np.round(investido, 2).tolist(),
        "proventos": np.round(prov_acum, 2).tolist(), "twr": np.round(np.array(twr) * 100 - 100, 3).tolist(),
        "totais": {
            "valor": round(v_fim, 2), "compras": round(compras, 2), "vendas": round(vendas, 2),
            "investido_liquido": round(inv_fim, 2), "proventos": round(pacum, 2),
            # lucro = o que vale hoje + o que já saiu (vendas e proventos) - o que entrou
            "lucro": round(v_fim + vendas + pacum - compras, 2),
            "twr": round((twr[-1] - 1) * 100, 2),
            "twr_anual": round((twr[-1] ** (365 / dias) - 1) * 100, 2) if dias >= 365 else None,
            "tir_anual": round(tir * 100, 2) if tir is not None and dias >= 30 else None,
        },
        "benchmarks": bench,
        "proventos_recebidos": recebidos[::-1][:200],
        "posicoes": posicoes,
        "ir": ir_mensal,
        "avisos": avisos,
    }
