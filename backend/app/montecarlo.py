"""Simulações de Monte Carlo: patrimônio de uma carteira (com aportes e meta) e cone de preço de um ativo.

Métodos de geração dos retornos diários futuros:
* bootstrap — sorteia blocos de 20 dias do histórico real (preserva caudas gordas, assimetria e volatilidade
  em grupos; na carteira, os blocos são das mesmas datas para todos os ativos, então a correlação vem junto);
* normal — passeio aleatório geométrico (GBM) com média e volatilidade históricas;
* t — como o normal, mas com t de Student (4 graus de liberdade) para quedas extremas mais frequentes.

Carteira: rebalanceada para os pesos-alvo; aporte no fim de cada mês. Os proventos podem ser reinvestidos (retorno
total) ou sacados (o patrimônio cresce só pelo preço e o provento vira renda); nos dois casos a renda mensal gerada
é medida — no bootstrap, pelos proventos dos mesmos dias sorteados; nos métodos paramétricos, pelo rendimento médio.
"""
import math
from datetime import date

import numpy as np
import pandas as pd

from . import impostos
from .portfolio import exigir_historico, proventos_alinhados, retornos_alinhados
from .yahoo import TAXA_LIVRE_RISCO, ajustar_splits, cotacao, eh_cripto, history

METODOS = {
    "bootstrap": "Bootstrap em blocos de 20 dias do histórico real",
    "normal": "Passeio aleatório geométrico (retornos normais)",
    "t": "Retornos t de Student (caudas gordas, 4 graus de liberdade)",
}
PERCENTIS = [5, 10, 25, 50, 75, 90, 95]
BLOCO = 20
MAX_PONTOS = 12_000_000  # simulações x dias — limita memória/tempo da função


def _indices_bootstrap(T: int, dias: int, n: int, rng: np.random.Generator) -> np.ndarray:
    blocos = math.ceil(dias / BLOCO)
    inicio = rng.integers(0, T, size=(n, blocos), dtype=np.int32)
    idx = (inicio[:, :, None] + np.arange(BLOCO, dtype=np.int32)[None, None, :]) % T  # circular
    return idx.reshape(n, -1)[:, :dias]


def _choques(metodo: str, n: int, dias: int, rng: np.random.Generator) -> np.ndarray:
    if metodo == "t":
        gl = 4
        return rng.standard_t(gl, size=(n, dias)) / math.sqrt(gl / (gl - 2))
    return rng.standard_normal((n, dias))


def _gerar(r: np.ndarray, dias: int, n: int, metodo: str, rng: np.random.Generator, z: np.ndarray | None = None) -> np.ndarray:
    """Matriz (n, dias) de retornos diários simulados a partir da série histórica r (z: choques já sorteados)."""
    if metodo == "bootstrap":
        return r[_indices_bootstrap(len(r), dias, n, rng)].astype(np.float32)
    lr = np.log1p(r)
    mu, sd = lr.mean(), lr.std(ddof=1)
    z = _choques(metodo, n, dias, rng) if z is None else z
    return np.expm1(mu + sd * z).astype(np.float32)


BENCHMARKS = {"IBOV": "^BVSP", "IFIX": "XFIX11", "S&P 500": "IVVB11", "CDI": "CDI"}


def _retornos_benchmark(nome: str, periodo: str, datas: pd.DatetimeIndex) -> np.ndarray | None:
    """Retornos diários do índice nas datas da carteira (retorno total; o Ibovespa já reinveste proventos)."""
    simbolo = BENCHMARKS.get(nome, nome)
    h = history(simbolo, periodo)
    if h.empty:
        return None
    close = h["Close"].dropna()
    if "Dividends" in h and simbolo != "^BVSP":
        close = ((close + h["Dividends"].reindex(close.index).fillna(0)) / close.shift(1)).fillna(1).cumprod()
    idx = close.index.tz_localize(None) if close.index.tz is not None else close.index
    close = pd.Series(close.to_numpy(), index=idx.normalize())
    close = close[~close.index.duplicated(keep="last")]
    # fechamento do índice em cada data da carteira (último conhecido) e o retorno entre datas consecutivas,
    # inclusive a primeira, que usa o fechamento anterior a ela
    cal = close.index.union(datas)
    cheio = close.reindex(cal).ffill()
    ant = cheio.shift(1).reindex(datas)
    agora = cheio.reindex(datas)
    if agora.isna().mean() > 0.1:
        return None  # histórico do índice não cobre a janela da carteira
    pos = cal.get_indexer(datas)
    anterior = pd.Series(cheio.to_numpy()[np.maximum(pos - 1, 0)], index=datas)
    # entre duas datas da carteira o índice pode ter vários pregões: o retorno é o acumulado desde a data anterior
    base = agora.shift(1)
    base.iloc[0] = anterior.iloc[0]
    return np.nan_to_num((agora / base - 1).to_numpy(), nan=0.0)


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
    proventos: str = "reinvestir",
    meta_tipo: str = "patrimonio",
    ir: bool = False,
    anos_saque: float = 0,
    saque_mensal: float = 0,
    benchmark: str | None = "IBOV",
) -> dict:
    """proventos: "reinvestir" (retorno total) ou "sacar" (o patrimônio cresce só pelo preço; o provento é renda).
    meta_tipo: "patrimonio" (valor final) ou "renda" (renda mensal média dos últimos 12 meses do horizonte).
    ir: desconta o IR dos proventos (todo mês) e o IR sobre o ganho num resgate total no fim (ver impostos.py).
    anos_saque, saque_mensal: depois de `anos` acumulando, saca `saque_mensal` (em reais de hoje se houver
    inflação) por `anos_saque` anos; o patrimônio que zera fica zerado (o dinheiro acabou).
    benchmark: IBOV, IFIX, S&P 500, CDI ou um ticker — simulado com os mesmos sorteios (mesmas datas no bootstrap;
    choques correlacionados nos métodos paramétricos) e os mesmos aportes/saques; None desliga."""
    if proventos not in ("reinvestir", "sacar"):
        raise ValueError("proventos deve ser 'reinvestir' ou 'sacar'.")
    if meta_tipo not in ("patrimonio", "renda"):
        raise ValueError("meta_tipo deve ser 'patrimonio' ou 'renda'.")
    sacar = proventos == "sacar"
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

    R_df, series, dias_ano = retornos_alinhados(tickers, periodo)
    exigir_historico(R_df, tickers, series, 120)
    Dm = proventos_alinhados(tickers, series, R_df).to_numpy()
    r = R_df.to_numpy() @ w  # carteira rebalanceada aos pesos-alvo (retorno total)
    d = Dm @ w  # parte do retorno que veio de proventos
    tx = impostos.aliquotas(tickers) if ir else None
    if ir:  # provento chega líquido do IR retido na fonte
        tp = np.array(tx["proventos"])
        r, d = r - Dm @ (w * tp), Dm @ (w * (1 - tp))
    del Dm

    macc = max(1, round(anos * 12))  # meses acumulando
    msaq = max(0, round(anos_saque * 12)) if saque_mensal > 0 else 0
    meses = macc + msaq
    dpm = dias_ano / 12
    dias = math.ceil(meses * dpm)
    n = int(min(simulacoes, MAX_PONTOS // dias, 20_000))
    rng = np.random.default_rng(semente)
    limites = np.round(np.arange(meses + 1) * dpm).astype(int)

    def por_mes(diario: np.ndarray) -> np.ndarray:
        """Soma de log(1 + retorno) de cada mês → fator de crescimento mensal (n, meses)."""
        acum = np.concatenate([np.zeros((n, 1)), np.cumsum(np.log1p(diario), axis=1, dtype=np.float64)], axis=1)
        return np.exp(acum[:, limites[1:]] - acum[:, limites[:-1]])

    rb = None
    if benchmark:
        try:
            # R_df.index são as datas dos retornos; o fechamento da véspera vem da série do índice
            rb = _retornos_benchmark(benchmark, periodo, R_df.index)
        except Exception:
            rb = None
    sim_b = None
    if metodo == "bootstrap":
        idx = _indices_bootstrap(len(r), dias, n, rng)
        sim, sim_d = r[idx].astype(np.float32), d[idx].astype(np.float32)
        if rb is not None:
            sim_b = rb[idx].astype(np.float32)
        del idx
    else:
        z = _choques(metodo, n, dias, rng)
        sim, sim_d = _gerar(r, dias, n, metodo, rng, z), np.full((1, dias), d.mean(), np.float32)
        if rb is not None:  # choque do índice correlacionado com o da carteira
            lr, lb = np.log1p(r), np.log1p(rb)
            rho = float(np.corrcoef(lr, lb)[0, 1]) if lb.std() > 0 else 0.0
            zb = rho * z + math.sqrt(max(0.0, 1 - rho ** 2)) * _choques(metodo, n, dias, rng)
            sim_b = np.expm1(lb.mean() + lb.std(ddof=1) * zb).astype(np.float32)
            del zb
        del z
    G_total = por_mes(sim)
    Gb = por_mes(sim_b) / (1 + inflacao) ** (1 / 12) if sim_b is not None else None
    del sim_b
    G = por_mes(sim - sim_d) if sacar else G_total  # sacando, o patrimônio cresce só pelo preço
    # rendimento em proventos de cada mês, sobre o patrimônio do início do mês
    acum_d = np.concatenate([np.zeros((sim_d.shape[0], 1)), np.cumsum(sim_d, axis=1, dtype=np.float64)], axis=1)
    Y = np.broadcast_to(acum_d[:, limites[1:]] - acum_d[:, limites[:-1]], (n, meses))
    del sim, sim_d, acum_d

    # Tudo em reais de hoje: com inflação > 0 o crescimento é descontado mês a mês e o aporte é corrigido
    # pela inflação (aporte real constante). Com inflação 0, os valores são nominais.
    deflator = (1 + inflacao) ** (1 / 12)
    G = G / deflator
    G_total = G_total / deflator
    # V = V0·I + aporte·B para os mesmos sorteios (I: crescimento acumulado; B: aportes de 1 real acumulados)
    # Na aposentadoria, W acumula saques de 1 real: V = V0·I + aporte·B - saque·W
    I = np.ones((n, meses + 1))
    B = np.zeros((n, meses + 1))
    W = np.zeros((n, meses + 1)) if msaq else None
    for m in range(meses):
        I[:, m + 1] = I[:, m] * G[:, m]
        B[:, m + 1] = B[:, m] * G[:, m] + (1 if m < macc else 0)
        if msaq:
            W[:, m + 1] = W[:, m] * G[:, m] + (1 if m >= macc else 0)
    V = valor_inicial * I + aporte_mensal * B
    vivo = np.ones((n, meses + 1), bool)
    if msaq:
        V = V - saque_mensal * W
        vivo = np.minimum.accumulate(V > 0, axis=1)  # zerou uma vez, acabou
        V = np.where(vivo, V, 0.0)
    renda = V[:, :-1] * Y  # proventos de cada mês (n, meses), em reais de hoje se houver inflação
    jan = np.minimum(np.arange(1, meses + 1), 12)
    c = np.concatenate([np.zeros((n, 1)), np.cumsum(renda, axis=1)], axis=1)
    renda_12m = (c[:, 1:] - c[:, np.arange(1, meses + 1) - jan]) / jan  # média mensal dos últimos 12 meses
    recebido = renda.sum(axis=1)

    investido = valor_inicial + aporte_mensal * np.minimum(np.arange(meses + 1), macc)
    rf_m = ((1 + rf) / (1 + inflacao)) ** (1 / 12) - 1
    renda_fixa = np.empty(meses + 1)
    renda_fixa[0] = valor_inicial
    for m in range(meses):
        renda_fixa[m + 1] = max(0.0, renda_fixa[m] * (1 + rf_m) + (aporte_mensal if m < macc else -saque_mensal))
    # total sacado na aposentadoria (só os meses em que ainda havia dinheiro)
    sacado = saque_mensal * vivo[:, macc + 1:].sum(axis=1) if msaq else np.zeros(n)
    Vb = None
    if Gb is not None:  # o mesmo dinheiro, com os mesmos aportes e saques, no índice
        Vb = np.empty((n, meses + 1))
        Vb[:, 0] = valor_inicial
        for m in range(meses):
            Vb[:, m + 1] = np.maximum(Vb[:, m] * Gb[:, m] + (aporte_mensal if m < macc else -saque_mensal), 0)
    final = V[:, -1]
    rf_fim = renda_fixa[-1]
    imposto = np.zeros(n)
    if ir:
        # IR sobre o ganho nominal num resgate total no fim; alíquota média ponderada pelos pesos
        tg = float(w @ np.array(tx["ganho"]))
        corr = (1 + inflacao) ** (meses / 12)
        inv_nom = valor_inicial + aporte_mensal * sum((1 + inflacao) ** (m / 12) for m in range(1, macc + 1))
        inv_rf = inv_nom
        if msaq:  # o que foi sacado leva junto parte do custo (aproximação: custo baixa pelo valor sacado)
            inv_rf = max(inv_nom - saque_mensal * msaq * corr ** 0.5, 0)
            inv_nom = np.maximum(inv_nom - sacado * corr ** 0.5, 0)
        imposto = tg * np.maximum(final * corr - inv_nom, 0) / corr
        rf_fim = renda_fixa[-1] - impostos.GANHO["RF"] * max(renda_fixa[-1] * corr - inv_rf, 0) / corr
    liquido = final - imposto
    # sacando, o resultado inclui o que foi recebido em proventos (somado, sem render); com IR, depois do resgate
    resultado = (liquido + recebido if sacar else liquido) + sacado
    indice = np.concatenate([np.ones((n, 1)), np.cumprod(G_total, axis=1)], axis=1)  # retorno total ponderado no tempo
    cagr = indice[:, -1] ** (12 / meses) - 1
    dd = _mdd(I)
    q5 = np.percentile(resultado, 5)
    bench_out = None
    if Vb is not None:
        vb_fim = Vb[:, -1]
        if ir:  # índice também paga 15% sobre o ganho no resgate
            vb_fim = vb_fim - 0.15 * np.maximum(vb_fim * corr - inv_rf, 0) / corr
        vivo_b = Vb[:, -1] > 0 if msaq else np.ones(n, bool)
        sacado_b = saque_mensal * (Vb[:, macc + 1:] > 0).sum(axis=1) if msaq else 0
        bench_out = {
            "nome": benchmark, "simbolo": BENCHMARKS.get(benchmark, benchmark),
            "mediana": np.round(np.percentile(Vb, 50, axis=0), 2).tolist(),
            "final": {f"p{p}": round(float(v), 2) for p, v in zip(PERCENTIS, np.percentile(vb_fim, PERCENTIS))},
            # mesmo cenário: a carteira terminou melhor que o índice? (com saques, compara patrimônio + sacado)
            "prob_superar": round(float((resultado > vb_fim + sacado_b).mean() * 100), 2),
            "prob_sucesso": round(float(vivo_b.mean() * 100), 2) if msaq else None,
        }
    r2 = lambda v: round(float(v), 2)
    pct = lambda v: {f"p{p}": r2(x) for p, x in zip(PERCENTIS, np.percentile(v, PERCENTIS))}

    out = {
        "parametros": {
            "tickers": tickers, "pesos": dict(zip(tickers, np.round(w, 4).tolist())), "valor_inicial": valor_inicial,
            "aporte_mensal": aporte_mensal, "anos": anos, "meses": meses, "meses_acumulacao": macc,
            "anos_saque": anos_saque if msaq else 0, "saque_mensal": saque_mensal if msaq else 0, "simulacoes": n, "metodo": metodo,
            "metodo_descricao": METODOS[metodo], "periodo": periodo, "inflacao": inflacao, "taxa_livre_risco": rf,
            "valores_reais": inflacao > 0,
            "dias_ano": dias_ano, "inicio": R_df.index[0].strftime("%Y-%m-%d"), "fim": R_df.index[-1].strftime("%Y-%m-%d"),
            "dias_historico": len(R_df),
            "retorno_hist_anual": round(float((1 + r).prod() ** (dias_ano / len(r)) - 1) * 100, 2),
            "dy_hist_anual": round(float(d.mean() * dias_ano) * 100, 2),
            "ir": {"aliquota_ganho_media": round(float(w @ np.array(tx["ganho"])) * 100, 2), "classes": tx["tabela"]} if ir else None,
            "proventos": proventos,
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
            "renda_fixa": r2(rf_fim),
            "liquido": pct(liquido) if ir else None,
            "imposto": pct(imposto) if ir else None,
            # com saque, as comparações usam patrimônio + proventos recebidos
            "prob_perda": r2((resultado < investido[-1]).mean() * 100),
            "prob_superar_renda_fixa": r2((resultado > rf_fim).mean() * 100),
            # perda frente ao total aportado no pior cenário de 5% (0 = mesmo esse cenário termina no lucro)
            "perda_95": r2(max(0.0, investido[-1] - q5)),
            "perda_media_5_piores": r2(max(0.0, investido[-1] - resultado[resultado <= q5].mean())),
            "cagr": {f"p{p}": r2(v * 100) for p, v in zip(PERCENTIS, np.percentile(cagr, PERCENTIS))},
            "max_drawdown": {"p50": r2(np.percentile(dd, 50) * 100), "p95": r2(np.percentile(dd, 5) * 100)},
        },
        "histograma": _hist(final),
        "benchmark": bench_out,
        "renda": {
            # renda mensal média dos últimos 12 meses, mês a mês (o primeiro ponto é o mês 1)
            "bandas": _pct(np.concatenate([renda_12m[:, :1], renda_12m], axis=1)),
            "primeiro_ano": pct(renda_12m[:, min(11, meses - 1)]),
            "final": pct(renda_12m[:, -1]),
            "recebido": pct(recebido),
            "resultado_com_recebido": pct(resultado) if sacar else None,
            # renda anual no fim sobre o total aportado
            "yield_on_cost": r2(np.median(renda_12m[:, -1]) * 12 / investido[-1] * 100) if investido[-1] else None,
        },
    }

    if msaq:
        # Para cada cenário, o maior saque que nunca zera o patrimônio: V_t = A_t - s·W_t > 0 em todo mês de saque
        # ⇒ s < min_t A_t / W_t. O saque seguro para p% de chance é o percentil (100 - p) desse máximo.
        A = valor_inicial * I[:, macc + 1:] + aporte_mensal * B[:, macc + 1:]
        s_max = (A / W[:, macc + 1:]).min(axis=1)
        inicio = valor_inicial * I[:, macc] + aporte_mensal * B[:, macc]
        acabou = ~vivo[:, -1]
        mes_fim = np.where(acabou, vivo[:, macc:].sum(axis=1), -1)  # meses de saque até zerar
        out["aposentadoria"] = {
            "saque_mensal": saque_mensal, "anos_saque": anos_saque, "inicio_mes": macc,
            "prob_sucesso": r2(vivo[:, -1].mean() * 100),
            "prob_por_ano": [{"ano": a, "prob": r2(vivo[:, min(macc + a * 12, meses)].mean() * 100)} for a in range(1, math.ceil(msaq / 12) + 1)],
            "patrimonio_inicio": pct(inicio),
            "anos_ate_acabar_mediana": r2(np.median(mes_fim[acabou]) / 12) if acabou.any() else None,
            "saque_seguro": {str(p): r2(max(0.0, np.percentile(s_max, 100 - p))) for p in (95, 90, 75, 50)},
            "regra_4pct": r2(np.median(inicio) * 0.04 / 12),
            "sacado": pct(sacado),
        }

    if meta:
        # alvo linear em V0 e no aporte para os mesmos sorteios: alvo = V0·A + aporte·Bf → aporte necessário por bisseção
        if meta_tipo == "renda":
            ult = slice(max(0, meses - 12), meses)
            A = (I[:, ult] * Y[:, ult]).mean(axis=1)
            Bf = (B[:, ult] * Y[:, ult]).mean(axis=1)
            serie, alvo_final = np.concatenate([renda_12m[:, :1], renda_12m], axis=1), renda_12m[:, -1]
        else:
            A, Bf, serie, alvo_final = I[:, -1], B[:, -1], V, final

        def aporte_para(prob):
            q = 100 - prob
            if np.percentile(valor_inicial * A, q) >= meta:
                return 0.0
            if not np.percentile(Bf, q) > 0:
                return None  # carteira sem proventos: nenhum aporte gera renda
            lo, hi = 0.0, max(meta, 1.0)
            while np.percentile(valor_inicial * A + hi * Bf, q) < meta:
                hi *= 2
                if hi > 1e9:
                    return None
            for _ in range(60):
                mid = (lo + hi) / 2
                lo, hi = (lo, mid) if np.percentile(valor_inicial * A + mid * Bf, q) >= meta else (mid, hi)
            return r2(hi)

        atingiu = serie >= meta
        primeiro = np.where(atingiu.any(axis=1), atingiu.argmax(axis=1), -1)
        out["meta"] = {
            "valor": meta,
            "tipo": meta_tipo,
            "prob": r2((alvo_final >= meta).mean() * 100),
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
        raise ValueError(
            f"Histórico insuficiente: {ticker} tem {len(r)} dias de retorno desde {close.index[0]:%d/%m/%Y}, mínimo 120."
        )
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
