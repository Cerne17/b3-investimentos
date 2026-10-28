"""Simulações de Monte Carlo: patrimônio de uma carteira (com aportes e meta) e cone de preço de um ativo.

Métodos de geração dos retornos diários futuros:
* bootstrap — sorteia blocos de 20 dias do histórico real (preserva caudas gordas, assimetria e volatilidade
  em grupos; na carteira, os blocos são das mesmas datas para todos os ativos, então a correlação vem junto);
* normal — passeio aleatório geométrico (GBM) com média e volatilidade históricas;
* t — como o normal, mas com t de Student (4 graus de liberdade) para quedas extremas mais frequentes.

Carteira: retorno total (preço + proventos reinvestidos), rebalanceada para os pesos-alvo; aporte no fim de cada mês.
"""
import math
from datetime import date

import numpy as np
import pandas as pd

from .portfolio import retornos_alinhados
from .yahoo import TAXA_LIVRE_RISCO, ajustar_splits, cotacao, eh_cripto, history

METODOS = {
    "bootstrap": "Bootstrap em blocos de 20 dias do histórico real",
    "normal": "Passeio aleatório geométrico (retornos normais)",
    "t": "Retornos t de Student (caudas gordas, 4 graus de liberdade)",
}
PERCENTIS = [5, 10, 25, 50, 75, 90, 95]
BLOCO = 20
MAX_PONTOS = 12_000_000  # simulações x dias — limita memória/tempo da função


def _gerar(r: np.ndarray, dias: int, n: int, metodo: str, rng: np.random.Generator) -> np.ndarray:
    """Matriz (n, dias) de retornos diários simulados a partir da série histórica r."""
    if metodo == "bootstrap":
        blocos = math.ceil(dias / BLOCO)
        inicio = rng.integers(0, len(r), size=(n, blocos), dtype=np.int32)
        idx = (inicio[:, :, None] + np.arange(BLOCO, dtype=np.int32)[None, None, :]) % len(r)  # circular
        return r[idx.reshape(n, -1)[:, :dias]].astype(np.float32)
    lr = np.log1p(r)
    mu, sd = lr.mean(), lr.std(ddof=1)
    if metodo == "t":
        gl = 4
        z = rng.standard_t(gl, size=(n, dias)) / math.sqrt(gl / (gl - 2))
    else:
        z = rng.standard_normal((n, dias))
    return np.expm1(mu + sd * z).astype(np.float32)


def _pct(m: np.ndarray, eixo=0) -> dict:
    q = np.percentile(m, PERCENTIS, axis=eixo)
    return {f"p{p}": np.round(q[i], 2).tolist() for i, p in enumerate(PERCENTIS)}


def _hist(v: np.ndarray, bins: int = 40) -> dict:
    lo, hi = np.percentile(v, [0.5, 99.5])
    cont, bordas = np.histogram(np.clip(v, lo, hi), bins=bins, range=(lo, hi))
    return {"bordas": np.round(bordas, 2).tolist(), "contagens": cont.tolist()}


def _mdd(caminhos: np.ndarray) -> np.ndarray:
    """Maior queda pico-vale de cada caminho (linhas)."""
    pico = np.maximum.accumulate(caminhos, axis=1)
    return (caminhos / pico - 1).min(axis=1)


def _meses(n: int) -> list[str]:
    hoje = date.today().replace(day=1)
    return [(pd.Timestamp(hoje) + pd.DateOffset(months=m)).strftime("%Y-%m-%d") for m in range(n + 1)]


def simular_carteira(
    tickers: list[str],
    pesos: list[float] | dict | None = None,
    valor_inicial: float = 10_000,
    aporte_mensal: float = 0,
    anos: float = 10,
    simulacoes: int = 5000,
    metodo: str = "bootstrap",
    periodo: str = "5y",
    meta: float | None = None,
    inflacao: float = 0.0,
    taxa_livre_risco: float | None = None,
    semente: int | None = 42,
) -> dict:
    tickers = list(dict.fromkeys(t.strip().upper().replace(".SA", "") for t in tickers if t.strip()))
    if not tickers:
        raise ValueError("Informe pelo menos um ativo.")
    if metodo not in METODOS:
        raise ValueError(f"método desconhecido: {metodo} (use {', '.join(METODOS)})")
    if isinstance(pesos, dict):
        pesos = [float(pesos.get(t, pesos.get(t.replace("-BRL", ""), 0))) for t in tickers]
    w = np.full(len(tickers), 1 / len(tickers)) if not pesos else np.array(pesos, float)
    if len(w) != len(tickers) or w.min() < 0 or w.sum() <= 0:
        raise ValueError("Pesos inválidos: um peso não negativo por ativo.")
    w = w / w.sum()
    rf = TAXA_LIVRE_RISCO if taxa_livre_risco is None else taxa_livre_risco

    R_df, _, dias_ano = retornos_alinhados(tickers, periodo)
    if len(R_df) < 120:
        raise ValueError("Histórico comum insuficiente (menos de 120 dias em comum).")
    r = R_df.to_numpy() @ w  # carteira rebalanceada aos pesos-alvo

    meses = max(1, round(anos * 12))
    dpm = dias_ano / 12
    dias = math.ceil(meses * dpm)
    n = int(min(simulacoes, MAX_PONTOS // dias, 20_000))
    rng = np.random.default_rng(semente)
    sim = _gerar(r, dias, n, metodo, rng)

    # fator de crescimento de cada mês (produto dos retornos diários do mês)
    limites = np.round(np.arange(meses + 1) * dpm).astype(int)
    acum = np.cumsum(np.log1p(sim), axis=1, dtype=np.float64)
    del sim
    acum = np.concatenate([np.zeros((n, 1)), acum], axis=1)
    G = np.exp(acum[:, limites[1:]] - acum[:, limites[:-1]])  # (n, meses)
    del acum

    # Tudo em reais de hoje: com inflação > 0 o crescimento é descontado mês a mês e o aporte é corrigido
    # pela inflação (aporte real constante). Com inflação 0, os valores são nominais.
    G = G / (1 + inflacao) ** (1 / 12)
    V = np.empty((n, meses + 1))
    V[:, 0] = valor_inicial
    for m in range(meses):
        V[:, m + 1] = V[:, m] * G[:, m] + aporte_mensal
    investido = valor_inicial + aporte_mensal * np.arange(meses + 1)
    rf_m = ((1 + rf) / (1 + inflacao)) ** (1 / 12) - 1
    renda_fixa = np.empty(meses + 1)
    renda_fixa[0] = valor_inicial
    for m in range(meses):
        renda_fixa[m + 1] = renda_fixa[m] * (1 + rf_m) + aporte_mensal
    final = V[:, -1]
    indice = np.concatenate([np.ones((n, 1)), np.cumprod(G, axis=1)], axis=1)  # retorno ponderado no tempo
    cagr = indice[:, -1] ** (12 / meses) - 1
    dd = _mdd(indice)
    q5 = np.percentile(final, 5)
    r2 = lambda v: round(float(v), 2)

    out = {
        "parametros": {
            "tickers": tickers, "pesos": dict(zip(tickers, np.round(w, 4).tolist())), "valor_inicial": valor_inicial,
            "aporte_mensal": aporte_mensal, "anos": anos, "meses": meses, "simulacoes": n, "metodo": metodo,
            "metodo_descricao": METODOS[metodo], "periodo": periodo, "inflacao": inflacao, "taxa_livre_risco": rf,
            "valores_reais": inflacao > 0,
            "dias_ano": dias_ano, "inicio": R_df.index[0].strftime("%Y-%m-%d"), "fim": R_df.index[-1].strftime("%Y-%m-%d"),
            "dias_historico": len(R_df),
            "retorno_hist_anual": round(float((1 + r).prod() ** (dias_ano / len(r)) - 1) * 100, 2),
            "vol_hist_anual": round(float(r.std(ddof=1) * math.sqrt(dias_ano)) * 100, 2),
        },
        "datas": _meses(meses),
        "bandas": _pct(V),
        "investido": np.round(investido, 2).tolist(),
        "renda_fixa": np.round(renda_fixa, 2).tolist(),
        "caminhos": np.round(V[rng.choice(n, size=min(12, n), replace=False)], 2).tolist(),
        "final": {
            **{f"p{p}": r2(v) for p, v in zip(PERCENTIS, np.percentile(final, PERCENTIS))},
            "media": r2(final.mean()),
            "investido": r2(investido[-1]),
            "renda_fixa": r2(renda_fixa[-1]),
            "prob_perda": r2((final < investido[-1]).mean() * 100),
            "prob_superar_renda_fixa": r2((final > renda_fixa[-1]).mean() * 100),
            # perda frente ao total aportado no pior cenário de 5% (0 = mesmo esse cenário termina no lucro)
            "perda_95": r2(max(0.0, investido[-1] - q5)),
            "perda_media_5_piores": r2(max(0.0, investido[-1] - final[final <= q5].mean())),
            "cagr": {f"p{p}": r2(v * 100) for p, v in zip(PERCENTIS, np.percentile(cagr, PERCENTIS))},
            "max_drawdown": {"p50": r2(np.percentile(dd, 50) * 100), "p95": r2(np.percentile(dd, 5) * 100)},
        },
        "histograma": _hist(final),
    }

    if meta:
        # V_final = V0·A + aporte·B (linear no aporte para os mesmos sorteios) → aporte necessário por bisseção
        A = indice[:, -1]
        B = np.zeros(n)
        for m in range(meses):  # aporte do fim do mês m+1 cresce pelos meses seguintes
            B += indice[:, -1] / indice[:, m + 1]

        def aporte_para(prob):
            q = 100 - prob
            if np.percentile(valor_inicial * A, q) >= meta:
                return 0.0
            lo, hi = 0.0, max(meta, 1.0)
            for _ in range(60):
                mid = (lo + hi) / 2
                lo, hi = (lo, mid) if np.percentile(valor_inicial * A + mid * B, q) >= meta else (mid, hi)
            return r2(hi)

        atingiu = V >= meta
        primeiro = np.where(atingiu.any(axis=1), atingiu.argmax(axis=1), -1)
        out["meta"] = {
            "valor": meta,
            "prob": r2((final >= meta).mean() * 100),
            "prob_por_ano": [{"ano": a, "prob": r2(atingiu[:, :min(a * 12, meses) + 1].any(axis=1).mean() * 100)}
                             for a in range(1, math.ceil(meses / 12) + 1)],
            # mediana do mês em que a meta é atingida pela primeira vez (se mais da metade chega lá)
            "meses_mediana": int(np.median(np.where(primeiro >= 0, primeiro, 10**6))) if (primeiro >= 0).mean() > 0.5 else None,
            "aporte_necessario": {str(p): aporte_para(p) for p in (50, 75, 90)},
        }
    return out


def simular_ativo(
    ticker: str,
    dias: int = 252,
    simulacoes: int = 3000,
    metodo: str = "bootstrap",
    periodo: str = "5y",
    alvo_alta: float = 20.0,
    alvo_queda: float = -20.0,
    semente: int | None = 42,
) -> dict:
    """Cone de preço: distribuição do preço nos próximos `dias` pregões (dias corridos para cripto)."""
    if metodo not in METODOS:
        raise ValueError(f"método desconhecido: {metodo}")
    ticker = ticker.strip().upper().replace(".SA", "")
    hist = history(ticker, periodo)
    if hist.empty:
        raise LookupError(f"Sem histórico para {ticker} no Yahoo Finance")
    cripto = eh_cripto(ticker)
    if not cripto:
        hist, _ = ajustar_splits(hist)
    close = hist["Close"].dropna()
    r = close.pct_change().dropna().to_numpy()
    if len(r) < 120:
        raise ValueError("Histórico insuficiente (menos de 120 dias).")
    try:
        p0 = float(cotacao(ticker)["preco"]) or float(close.iloc[-1])
    except Exception:
        p0 = float(close.iloc[-1])
    dias_ano = 365 if cripto else 252
    n = int(min(simulacoes, MAX_PONTOS // dias, 10_000))
    rng = np.random.default_rng(semente)
    sim = _gerar(r, dias, n, metodo, rng).astype(np.float64)
    caminhos = p0 * np.cumprod(1 + sim, axis=1)
    caminhos = np.concatenate([np.full((n, 1), p0), caminhos], axis=1)
    final = caminhos[:, -1]
    q5 = np.percentile(final, 5)
    ultimo = close.index[-1]
    freq = "D" if cripto else "B"
    datas = pd.date_range(ultimo, periods=dias + 1, freq=freq)
    passo = max(1, dias // 180)  # até ~180 pontos no gráfico
    pos = list(range(0, dias + 1, passo)) + ([dias] if dias % passo else [])
    ret_final = (final / p0 - 1) * 100
    recente = close.tail(min(len(close), max(60, dias // 2)))
    return {
        "parametros": {"ticker": ticker, "dias": dias, "simulacoes": n, "metodo": metodo, "metodo_descricao": METODOS[metodo],
                       "periodo": periodo, "dias_ano": dias_ano, "preco_atual": round(p0, 6),
                       "inicio": close.index[0].strftime("%Y-%m-%d"), "fim": ultimo.strftime("%Y-%m-%d"),
                       "retorno_hist_anual": round(float((1 + r).prod() ** (dias_ano / len(r)) - 1) * 100, 2),
                       "vol_hist_anual": round(float(r.std(ddof=1) * math.sqrt(dias_ano)) * 100, 2)},
        "historico": {"datas": [d.strftime("%Y-%m-%d") for d in recente.index], "precos": np.round(recente.to_numpy(), 6).tolist()},
        "datas": [datas[i].strftime("%Y-%m-%d") for i in pos],
        "bandas": {f"p{p}": [float(f"{x:.6g}") for x in np.percentile(caminhos[:, pos], p, axis=0)] for p in PERCENTIS},
        "caminhos": [[float(f"{c[i]:.6g}") for i in pos] for c in caminhos[rng.choice(n, size=min(12, n), replace=False)]],
        "final": {
            **{f"p{p}": float(f"{v:.6g}") for p, v in zip(PERCENTIS, np.percentile(final, PERCENTIS))},
            "media": float(f"{final.mean():.6g}"),
            "retorno_esperado": round(float(ret_final.mean()), 2),
            "retorno_mediano": round(float(np.median(ret_final)), 2),
            "prob_alta": round(float((final > p0).mean()) * 100, 2),
            "prob_alvo_alta": round(float((caminhos.max(axis=1) >= p0 * (1 + alvo_alta / 100)).mean()) * 100, 2),
            "prob_alvo_queda": round(float((caminhos.min(axis=1) <= p0 * (1 + alvo_queda / 100)).mean()) * 100, 2),
            "var_95_pct": round(float((1 - q5 / p0) * 100), 2),
            "cvar_95_pct": round(float((1 - final[final <= q5].mean() / p0) * 100), 2),
            "max_drawdown_p50": round(float(np.percentile(_mdd(caminhos), 50)) * 100, 2),
        },
        "alvos": {"alta": alvo_alta, "queda": alvo_queda},
        "histograma": _hist(ret_final),
    }
