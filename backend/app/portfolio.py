"""Otimização de carteira (Markowitz e variações) com retornos totais (preço + proventos) do Yahoo Finance."""
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.optimize import minimize

from . import repository as repo
from . import rendafixa
from .yahoo import TAXA_LIVRE_RISCO, ajustar_splits, cotacao, eh_cripto, history

DIAS = 252

INDICADORES = {
    "sharpe": {"nome": "Máximo Sharpe", "descricao": "Maior retorno em excesso à taxa livre de risco por unidade de volatilidade."},
    "sortino": {"nome": "Máximo Sortino", "descricao": "Como o Sharpe, mas só penaliza a volatilidade das quedas."},
    "calmar": {"nome": "Máximo Calmar", "descricao": "Retorno anual composto dividido pela maior queda (drawdown). Foco em preservar capital."},
    "renda_risco": {"nome": "Máxima renda por risco", "descricao": "Dividend yield da carteira dividido pela volatilidade — renda recorrente com estabilidade."},
    "omega": {"nome": "Máximo Omega", "descricao": "Soma dos ganhos acima da taxa livre de risco dividida pela soma das perdas abaixo dela."},
    "min_vol": {"nome": "Mínima volatilidade", "descricao": "Carteira de menor variância (ponto mais à esquerda da fronteira eficiente)."},
    "min_cvar": {"nome": "Mínimo CVaR 95%", "descricao": "Minimiza a perda média nos 5% piores dias (risco de cauda)."},
    "min_drawdown": {"nome": "Mínimo drawdown", "descricao": "Minimiza a maior queda pico-vale do período."},
    "risk_parity": {"nome": "Paridade de risco", "descricao": "Cada ativo contribui com a mesma parcela do risco total."},
    "max_dy": {"nome": "Máximo dividend yield", "descricao": "Maior renda de proventos dos últimos 12 meses, sem olhar risco."},
    "max_retorno": {"nome": "Máximo retorno", "descricao": "Maior retorno esperado histórico, sem olhar risco."},
}

FILOSOFIAS = {
    "value_conservador": {
        "nome": "Value investing · conservador",
        "descricao": "Construção de patrimônio com margem de segurança: retorno ajustado a risco, proteção contra quedas e renda recorrente.",
        "indicadores": ["sharpe", "sortino", "calmar", "renda_risco"],
        "peso_max": 0.35,
    },
    "renda": {
        "nome": "Renda / dividendos",
        "descricao": "Prioriza fluxo de proventos estável.",
        "indicadores": ["renda_risco", "max_dy", "sortino", "min_vol"],
        "peso_max": 0.35,
    },
    "defensivo": {
        "nome": "Preservação de capital",
        "descricao": "Minimiza oscilação, perdas extremas e drawdowns.",
        "indicadores": ["min_vol", "min_cvar", "min_drawdown", "calmar"],
        "peso_max": 0.4,
    },
    "equilibrado": {
        "nome": "Equilibrado",
        "descricao": "Combina eficiência (Sharpe) com diversificação de risco.",
        "indicadores": ["sharpe", "risk_parity", "sortino", "min_vol"],
        "peso_max": 0.4,
    },
    "crescimento": {
        "nome": "Crescimento · arrojado",
        "descricao": "Aceita mais oscilação em troca de retorno.",
        "indicadores": ["max_retorno", "sharpe", "omega", "sortino"],
        "peso_max": 0.5,
    },
}

_CACHE: dict = {}


def _por_dia(serie: pd.Series) -> pd.Series:
    idx = serie.index.tz_localize(None) if serie.index.tz is not None else serie.index
    serie = serie.copy()
    serie.index = idx.normalize()
    return serie[~serie.index.duplicated(keep="last")]


def _serie_total(ticker: str, periodo: str) -> tuple[pd.Series, float, float, pd.Series]:
    """Índice de retorno total (preço + proventos reinvestidos, base 1), último preço e DY 12m."""
    chave = (ticker, periodo)
    hit = _CACHE.get(chave)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    hist = history(ticker, periodo)
    if hist.empty:
        raise LookupError(f"Sem histórico para {ticker} no Yahoo Finance")
    if not eh_cripto(ticker):
        hist, _ = ajustar_splits(hist)
    close = hist["Close"].dropna()
    divs = hist["Dividends"].reindex(close.index).fillna(0) if "Dividends" in hist else 0 * close
    ret = ((close + divs) / close.shift(1)).fillna(1)
    indice, so_preco = _por_dia(ret.cumprod()), _por_dia(close / close.iloc[0])
    ultimo = close.index[-1]
    dy = float(divs[divs.index >= ultimo - pd.Timedelta(days=365)].sum()) / float(close.iloc[-1]) * 100
    # (índice de retorno total, último preço, DY 12m, índice só de preço)
    out = (indice.rename(ticker), float(close.iloc[-1]), dy, so_preco.rename(ticker))
    _CACHE[chave] = (time.time(), out)
    return out


def retornos_alinhados(tickers: list[str], periodo: str) -> tuple[pd.DataFrame, list, int]:
    """Retornos diários de todos os ativos nas mesmas datas. Com algum ativo da bolsa, usa os pregões
    (o fim de semana da cripto entra no retorno de segunda); só cripto, usa todos os dias (365/ano)."""
    with ThreadPoolExecutor(max_workers=6) as pool:
        series = list(pool.map(lambda t: _serie_total(t, periodo), tickers))
    so_cripto = all(eh_cripto(t) for t in tickers)
    R_df = _alinhar(tickers, [s[0] for s in series])
    return R_df, series, 365 if so_cripto else DIAS


def _alinhar(tickers: list[str], indices: list[pd.Series]) -> pd.DataFrame:
    bolsa = [s for t, s in zip(tickers, indices) if not eh_cripto(t)]
    datas = sorted(set().union(*(s.index for s in bolsa))) if bolsa else None
    precos = []
    for ind in indices:
        if datas is not None:
            ind = ind.reindex(ind.index.union(datas)).ffill().reindex(datas)
        precos.append(ind)
    P = pd.concat(precos, axis=1).dropna()
    return P.pct_change().dropna()


def proventos_alinhados(tickers: list[str], series: list, R_df: pd.DataFrame) -> pd.DataFrame:
    """Rendimento diário em proventos de cada ativo (provento ÷ preço da véspera), nas mesmas datas de R_df:
    é a diferença entre o retorno total e o retorno só de preço."""
    R_preco = _alinhar(tickers, [s[3] for s in series]).reindex(R_df.index).fillna(0)
    D = R_df - R_preco.to_numpy()
    return D.where(D > 1e-7, 0.0)  # resíduo de ponto flutuante não é provento


def exigir_historico(R_df: pd.DataFrame, tickers: list[str], series: list, minimo: int) -> None:
    """Falha com uma mensagem que aponta quais ativos encurtam o histórico em comum."""
    if len(R_df) >= minimo:
        return
    inicio = {t: s[0].index[0] for t, s in zip(tickers, series)}
    curtos = [t for t, s in zip(tickers, series) if len(s[0]) - 1 < minimo]
    if not curtos:  # todos têm histórico, mas pouco em comum: culpa de quem começa mais tarde
        curtos = [max(inicio, key=inicio.get)]
    detalhe = ", ".join(
        f"{t} (desde {inicio[t]:%d/%m/%Y}, {len(s[0])} pregões)" for t, s in zip(tickers, series) if t in curtos
    )
    raise ValueError(
        f"Histórico comum insuficiente: {len(R_df)} dias em comum, mínimo {minimo}. "
        f"Limitado por {detalhe}. Remova esse ativo da simulação ou aguarde mais pregões."
    )


# ---------- métricas de uma carteira ----------

def metricas(w: np.ndarray, R: np.ndarray, dy: np.ndarray, rf: float, DIAS: int = DIAS) -> dict:
    r = R @ w
    rf_d = (1 + rf) ** (1 / DIAS) - 1
    ret = float(r.mean() * DIAS)
    vol = float(r.std(ddof=1) * math.sqrt(DIAS))
    down = float(np.sqrt(np.mean(np.minimum(r - rf_d, 0) ** 2)) * math.sqrt(DIAS))
    acum = np.cumprod(1 + r)
    cagr = float(acum[-1] ** (DIAS / len(r)) - 1)
    mdd = float((acum / np.maximum.accumulate(acum) - 1).min())
    q = np.quantile(r, 0.05)
    cvar = float(-r[r <= q].mean())
    ganhos, perdas = np.maximum(r - rf_d, 0).sum(), np.maximum(rf_d - r, 0).sum()
    dy_c = float(w @ dy)
    return {
        "retorno_anual": ret * 100,
        "cagr": cagr * 100,
        "volatilidade": vol * 100,
        "sharpe": (ret - rf) / vol if vol else None,
        "sortino": (ret - rf) / down if down else None,
        "max_drawdown": mdd * 100,
        "calmar": cagr / abs(mdd) if mdd else None,
        "cvar_95_diario": cvar * 100,
        "omega": float(ganhos / perdas) if perdas else None,
        "dividend_yield": dy_c,
        "renda_risco": dy_c / (vol * 100) if vol else None,
    }


def _objetivo(nome: str, R, mu, cov, dy, rf, DIAS: int = DIAS):
    rf_d = (1 + rf) ** (1 / DIAS) - 1

    def port(w):
        return R @ w

    def drawdown(w):
        acum = np.cumprod(1 + port(w))
        return (acum / np.maximum.accumulate(acum) - 1).min()

    fns = {
        "sharpe": lambda w: -(w @ mu - rf) / math.sqrt(max(w @ cov @ w, 1e-12)),
        "sortino": lambda w: -(w @ mu - rf) / (np.sqrt(np.mean(np.minimum(port(w) - rf_d, 0) ** 2)) * math.sqrt(DIAS) + 1e-12),
        "calmar": lambda w: -((np.prod(1 + port(w)) ** (DIAS / len(R)) - 1) / (abs(drawdown(w)) + 1e-9)),
        "renda_risco": lambda w: -(w @ dy) / (math.sqrt(max(w @ cov @ w, 1e-12)) * 100),
        "omega": lambda w: -np.maximum(port(w) - rf_d, 0).sum() / (np.maximum(rf_d - port(w), 0).sum() + 1e-12),
        "min_vol": lambda w: w @ cov @ w,
        "min_cvar": lambda w: -np.sort(port(w))[: max(1, int(len(R) * 0.05))].mean(),
        "min_drawdown": lambda w: -drawdown(w),
        "risk_parity": lambda w: float(np.sum(((w * (cov @ w)) / max(w @ cov @ w, 1e-12) - 1 / len(w)) ** 2)),
        "max_dy": lambda w: -(w @ dy) + 1e-6 * (w @ cov @ w),
        "max_retorno": lambda w: -(w @ mu),
    }
    if nome not in fns:
        raise ValueError(f"indicador desconhecido: {nome}")
    return fns[nome]


def _otimizar(fn, n, lo, hi, seed=0, extra=(), partidas=16):
    rng = np.random.default_rng(seed)
    cons = [{"type": "eq", "fun": lambda w: w.sum() - 1}, *extra]
    bounds = [(lo, hi)] * n
    inicios = [np.full(n, 1 / n)] + [rng.dirichlet(np.ones(n)) for _ in range(partidas - 1)]
    melhor = None
    for w0 in inicios:
        w0 = np.clip(w0, lo, hi)
        w0 = w0 / w0.sum()
        res = minimize(fn, w0, method="SLSQP", bounds=bounds, constraints=cons, options={"maxiter": 500, "ftol": 1e-10})
        if res.success or melhor is None:
            w = np.clip(res.x, lo, hi)
            w = w / w.sum()
            val = fn(w)
            if melhor is None or val < melhor[0]:
                melhor = (val, w)
    w = melhor[1]
    w[w < 1e-4] = 0
    return w / w.sum()


# ---------- estimativas robustas ----------

ESTIMATIVAS = {
    "historica": "Média e covariância históricas, como estão",
    "robusta": "Covariância com encolhimento de Ledoit-Wolf e retornos encolhidos (James-Stein) para um alvo neutro em que todo ativo tem o mesmo Sharpe",
    "reamostrada": "Fronteira reamostrada (Michaud): otimiza em 30 reamostragens do histórico e tira a média dos pesos",
}


def ledoit_wolf(R: np.ndarray) -> tuple[np.ndarray, float]:
    """Covariância encolhida para a identidade escalada (Ledoit & Wolf, 2004). Devolve a matriz e a intensidade."""
    T, n = R.shape
    X = R - R.mean(axis=0)
    S = X.T @ X / T
    X2 = X ** 2
    traco = X2.sum(axis=0) / T
    m = traco.sum() / n
    delta_ = float(np.sum(S ** 2))
    beta = (float(np.sum(X2.T @ X2)) / T - delta_) / (n * T)
    delta = (delta_ - 2 * m * traco.sum() + n * m ** 2) / n
    k = 0.0 if delta <= 0 else min(max(beta, 0.0), delta) / delta
    return (1 - k) * S + k * m * np.eye(n), float(k)


def james_stein(R: np.ndarray, cov: np.ndarray, rf_d: float, dias: int, sharpe: float = 0.3) -> tuple[np.ndarray, float]:
    """Retornos médios diários encolhidos (James-Stein) para um alvo neutro: todos os ativos com o mesmo Sharpe
    (taxa livre de risco + 0,3 x volatilidade ao ano). Encolher para a média simples deixaria todos com o mesmo
    retorno e o Sharpe máximo degeneraria; com o alvo neutro, o que sobra de diferença vem do histórico na medida
    em que ele é estatisticamente distinguível de ruído."""
    T, n = R.shape
    m = R.mean(axis=0)
    alvo = rf_d + sharpe * np.sqrt(np.diag(cov)) / math.sqrt(dias)
    dif = m - alvo
    try:
        q = float(dif @ np.linalg.solve(cov, dif))
    except np.linalg.LinAlgError:
        q = float(dif @ np.linalg.pinv(cov) @ dif)
    c = 1.0 if q <= 0 else min(1.0, max(0, n - 2) / (T * q))
    return (1 - c) * m + c * alvo, float(c)


def _reamostras(R: np.ndarray, k: int, seed: int = 7) -> list[np.ndarray]:
    """Reamostragens do histórico em blocos de 20 dias (mantém volatilidade em grupos e correlação)."""
    rng = np.random.default_rng(seed)
    T = len(R)
    blocos = math.ceil(T / 20)
    out = []
    for _ in range(k):
        ini = rng.integers(0, T, size=blocos)
        idx = ((ini[:, None] + np.arange(20)[None, :]) % T).ravel()[:T]
        out.append(R[idx])
    return out


def fronteira(mu, cov, lo, hi, pontos=30, extra=()):
    n = len(mu)
    cons_base = [{"type": "eq", "fun": lambda w: w.sum() - 1}, *extra]
    # faixa de retornos atingível respeitando os limites de peso
    w_min = _otimizar(lambda w: w @ mu, n, lo, hi, extra=extra)
    w_max = _otimizar(lambda w: -(w @ mu), n, lo, hi, extra=extra)
    r0, r1 = float(w_min @ mu), float(w_max @ mu)
    out = []
    for alvo in np.linspace(r0, r1, pontos):
        cons = cons_base + [{"type": "eq", "fun": lambda w, a=alvo: w @ mu - a}]
        res = minimize(lambda w: w @ cov @ w, np.full(n, 1 / n), method="SLSQP", bounds=[(lo, hi)] * n, constraints=cons)
        if res.success:
            out.append({"retorno": float(alvo * 100), "volatilidade": float(math.sqrt(res.x @ cov @ res.x) * 100)})
    return out


def alocar(w: np.ndarray, precos: np.ndarray, valor: float, peso_max: float, fracionario: np.ndarray | None = None) -> dict:
    """Converte pesos em cotas inteiras ao preço atual. Busca local (comprar uma cota / trocar uma cota de um
    ativo por outra) minimizando o desvio quadrático em R$ entre o alocado e o alvo, sem passar do valor
    disponível nem do peso máximo por ativo. Ativos fracionários (cripto) recebem o valor-alvo exato e
    absorvem a sobra das cotas inteiras até o peso máximo."""
    fracionario = np.zeros(len(w), bool) if fracionario is None else np.asarray(fracionario, bool)
    alvo = w * valor
    teto = peso_max * valor + 1e-6
    inteiros = ~fracionario
    cotas = np.where(fracionario, 0.0, np.floor(alvo / precos))
    caixa = valor - float(alvo[fracionario].sum())  # orçamento das cotas inteiras
    # desvio do alvo + caixa parado (sobra também conta como desvio; com cripto, a sobra vai para ela)
    pena = 0.0 if fracionario.any() else 1.0
    custo = lambda c: float(np.sum(((c * precos - alvo) ** 2)[inteiros]) + pena * (caixa - c[inteiros] @ precos[inteiros]) ** 2)
    ok = lambda c: c.min() >= 0 and c[inteiros] @ precos[inteiros] <= caixa + 1e-6 and np.all(c * precos <= teto)
    atual = custo(cotas)
    n = len(w)
    idx = [i for i in range(n) if inteiros[i]]
    for _ in range(1000 if idx else 0):
        melhor = None
        for i in idx:
            moves = [np.eye(n)[i]] + [np.eye(n)[i] - np.eye(n)[j] for j in idx if j != i] + [-np.eye(n)[i]]
            for m in moves:
                c = cotas + m
                if ok(c):
                    v = custo(c)
                    if v < atual - 1e-9 and (melhor is None or v < melhor[0]):
                        melhor = (v, c)
        if melhor is None:
            break
        atual, cotas = melhor
    if fracionario.any():
        sobra = valor - float(cotas[inteiros] @ precos[inteiros])
        valores_f = alvo[fracionario].copy()
        sobra -= valores_f.sum()
        # distribui a sobra entre as criptos proporcionalmente ao peso, respeitando o teto
        for _ in range(5):
            folga = np.maximum(teto - valores_f, 0)
            if sobra <= 0.01 or folga.sum() <= 0:
                break
            base = np.where(folga > 0, alvo[fracionario] + 1e-9, 0)
            extra = np.minimum(folga, sobra * base / base.sum())
            valores_f += extra
            sobra -= float(extra.sum())
        cotas[fracionario] = np.floor(valores_f / precos[fracionario] * 1e8) / 1e8
    investido = float(cotas @ precos)
    valores = cotas * precos
    return {
        "cotas": [float(c) if f else int(c) for c, f in zip(cotas, fracionario)],
        "fracionario": fracionario.tolist(),
        "precos": precos.round(2).tolist(),
        "valores": valores.round(2).tolist(),
        "pct_do_valor": (valores / valor).round(4).tolist(),
        "pesos_reais": (valores / investido if investido else valores * 0).round(4).tolist(),
        "investido": round(investido, 2),
        "sobra": round(valor - investido, 2),
    }


def otimizar(
    tickers: list[str],
    valor: float = 1000.0,
    peso_min: float = 0.0,
    peso_max: float = 0.35,
    indicadores: list[str] | None = None,
    filosofia: str | None = None,
    periodo: str = "2y",
    taxa_livre_risco: float | None = None,
    dy_min: float | None = None,
    ir: bool = False,
    estimativa: str = "historica",
) -> dict:
    """dy_min: dividend yield mínimo da carteira em % a.a. (restrição em todas as carteiras otimizadas).
    ir: otimiza com retornos líquidos de IR — ganho de preço x (1 - alíquota de ganho da classe), proventos x
    (1 - alíquota de proventos) e taxa livre de risco x 0,85 (renda fixa de longo prazo).
    estimativa: historica | robusta (Ledoit-Wolf + James-Stein) | reamostrada (Michaud) — ver ESTIMATIVAS.
    As métricas mostradas são sempre as realizadas no histórico."""
    if estimativa not in ESTIMATIVAS:
        raise ValueError(f"estimativa desconhecida: {estimativa} (use {', '.join(ESTIMATIVAS)})")
    tickers = list(dict.fromkeys(t.strip().upper().replace(".SA", "") for t in tickers if t.strip()))
    n = len(tickers)
    if n < 2:
        raise ValueError("Selecione pelo menos 2 ativos.")
    if peso_max * n < 1 - 1e-9:
        raise ValueError(f"Inviável: {n} ativos x {peso_max:.0%} máximo < 100%. Aumente o peso máximo ou adicione ativos.")
    if peso_min * n > 1 + 1e-9:
        raise ValueError("Inviável: soma dos pesos mínimos > 100%.")
    if filosofia:
        if filosofia not in FILOSOFIAS:
            raise ValueError(f"filosofia desconhecida: {filosofia}")
        indicadores = indicadores or FILOSOFIAS[filosofia]["indicadores"]
    indicadores = indicadores or ["sharpe", "sortino", "min_vol", "calmar"]
    rf = TAXA_LIVRE_RISCO if taxa_livre_risco is None else taxa_livre_risco

    R_df, series, dias = retornos_alinhados(tickers, periodo)
    exigir_historico(R_df, tickers, series, 60)
    R = R_df.to_numpy()
    tabela_ir = None
    if ir:
        from . import impostos
        tx = impostos.aliquotas(tickers)
        Dm = proventos_alinhados(tickers, series, R_df).to_numpy()
        R = (R - Dm) * (1 - np.array(tx["ganho"])) + Dm * (1 - np.array(tx["proventos"]))
        rf = rf * (1 - impostos.GANHO["RF"])
        tabela_ir = tx["tabela"]
    mu = R.mean(axis=0) * dias
    cov = np.cov(R, rowvar=False) * dias
    dy = np.array([s[2] for s in series])
    # o que entra na otimização (as métricas exibidas continuam sendo as realizadas, com R)
    R_opt, mu_opt, cov_opt, info_est = R, mu, cov, {"tipo": estimativa, "descricao": ESTIMATIVAS[estimativa]}
    if estimativa == "robusta":
        cov_d, k = ledoit_wolf(R)
        m_d, c = james_stein(R, cov_d, (1 + rf) ** (1 / dias) - 1, dias)
        cov_opt, mu_opt = cov_d * dias, m_d * dias
        R_opt = R - R.mean(axis=0) + m_d  # objetivos que usam a série (Sortino, Calmar...) também com a média encolhida
        info_est.update(encolhimento_cov=round(k, 3), encolhimento_retorno=round(c, 3))
    extra = ()
    if dy_min:
        dy_possivel = float(_otimizar(lambda w: -(w @ dy), n, peso_min, peso_max) @ dy)
        if dy_possivel < dy_min - 1e-6:
            raise ValueError(
                f"Inviável: com esses ativos e limites de peso o maior dividend yield possível é {dy_possivel:.2f}% a.a. "
                f"(pedido: {dy_min:.2f}%). Reduza o DY mínimo, aumente o peso máximo ou inclua ativos pagadores."
            )
        extra = ({"type": "ineq", "fun": lambda w: w @ dy - dy_min},)

    # preço atual da cota (tempo real; cai para o último fechamento)
    precos = []
    for t, s in zip(tickers, series):
        try:
            precos.append(float(cotacao(t)["preco"]) or s[1])
        except Exception:
            precos.append(s[1])
    precos = np.array(precos)

    # cripto e renda fixa compram valores fracionários (renda fixa: em reais)
    frac = np.array([eh_cripto(t) or rendafixa.eh_renda_fixa(t) for t in tickers])

    def montar(nome, chave, w, descricao):
        aloc = alocar(w, precos, valor, peso_max, frac)
        anual = float(np.array(aloc["valores"]) @ dy / 100)  # DY 12m de cada ativo sobre o valor comprado
        aloc["renda_anual"], aloc["renda_mensal"] = round(anual, 2), round(anual / 12, 2)
        return {
            "chave": chave, "nome": nome, "descricao": descricao,
            "pesos": dict(zip(tickers, w.round(4).tolist())),
            "metricas": {k: (round(v, 4) if v is not None else None) for k, v in metricas(w, R, dy, rf, dias).items()},
            "alocacao": aloc,
        }

    carteiras = []
    amostras = _reamostras(R, 30) if estimativa == "reamostrada" else None
    for i, ind in enumerate(indicadores):
        if amostras is not None:
            pesos = [_otimizar(_objetivo(ind, Rb, Rb.mean(axis=0) * dias, np.cov(Rb, rowvar=False) * dias, dy, rf, dias),
                               n, peso_min, peso_max, seed=i, extra=extra, partidas=2) for Rb in amostras]
            w = np.mean(pesos, axis=0)
            w[w < 1e-3] = 0
            w = w / w.sum()
        else:
            w = _otimizar(_objetivo(ind, R_opt, mu_opt, cov_opt, dy, rf, dias), n, peso_min, peso_max, seed=i, extra=extra)
        carteiras.append(montar(INDICADORES[ind]["nome"], ind, w, INDICADORES[ind]["descricao"]))
    eq = np.full(n, 1 / n)
    iguais = montar("Pesos iguais", "iguais", eq, "Referência: mesmo peso em cada ativo.")

    fundamentos = {}
    for t in tickers:
        if rendafixa.eh_renda_fixa(t):
            fundamentos[t] = {"tipo": "RF", "categoria": "Renda fixa", "nome_pregao": rendafixa.nome(t)}
            continue
        for tipo in (("cripto",) if eh_cripto(t) else ("acao", "fii", "etf")):
            d = repo.obter(tipo, t)
            if d:
                fundamentos[t] = {k: d.get(k) for k in ("categoria", "segmento", "pvp", "pl", "roe", "dividend_yield", "liquidez_media", "nome_pregao")}
                fundamentos[t]["tipo"] = tipo.upper()
                break

    ativos = []
    for j, t in enumerate(tickers):
        w = np.zeros(n); w[j] = 1
        m = metricas(w, R, dy, rf, dias)
        ativos.append({"ticker": t, "preco": round(float(precos[j]), 2), "retorno_anual": round(float(mu[j]) * 100, 2),
                       "volatilidade": round(math.sqrt(cov[j, j]) * 100, 2), "sharpe": round(m["sharpe"], 3) if m["sharpe"] is not None else None,
                       "max_drawdown": round(m["max_drawdown"], 2), "dividend_yield": round(float(dy[j]), 2),
                       **({"fundamentos": fundamentos[t]} if t in fundamentos else {})})

    return {
        "parametros": {"tickers": tickers, "valor": valor, "peso_min": peso_min, "peso_max": peso_max, "periodo": periodo,
                       "taxa_livre_risco": rf, "filosofia": filosofia, "indicadores": indicadores, "dy_min": dy_min, "ir": tabela_ir, "estimativa": info_est,
                       "inicio": R_df.index[0].strftime("%Y-%m-%d"), "fim": R_df.index[-1].strftime("%Y-%m-%d"), "pregoes": len(R_df), "dias_ano": dias},
        "ativos": ativos,
        "correlacao": {"tickers": tickers, "matriz": np.corrcoef(R, rowvar=False).round(3).tolist()},
        "carteiras": carteiras,
        "pesos_iguais": iguais,
        "fronteira": fronteira(mu_opt, cov_opt, peso_min, peso_max, extra=extra),
    }


# ---------- onde aportar ----------

def aportar(tickers: list[str], pesos: list[float], quantidades: list[float] | None, aporte: float) -> dict:
    """Compras (sem vender nada) que aproximam a carteira atual dos pesos-alvo usando só o aporte.

    1. alvo de cada ativo = peso x (valor atual + aporte); falta = alvo - valor atual (só o que está abaixo);
    2. se as faltas somam mais que o aporte, todas encolhem na mesma proporção;
    3. cripto e renda fixa compram o valor exato; os demais, cotas inteiras arredondadas para baixo e, com a sobra,
       uma cota por vez no ativo que mais reduz o desvio em relação ao alvo."""
    tickers = [t.strip().upper().replace(".SA", "") for t in tickers]
    n = len(tickers)
    w = np.array(pesos, float)
    if len(w) != n or w.min() < 0 or w.sum() <= 0:
        raise ValueError("Informe um peso não negativo por ativo.")
    w = w / w.sum()
    q0 = np.zeros(n) if not quantidades else np.array(quantidades, float)
    if len(q0) != n or q0.min() < 0:
        raise ValueError("Informe uma quantidade atual (≥ 0) por ativo.")
    if aporte <= 0:
        raise ValueError("O aporte precisa ser positivo.")
    precos = np.array([float(cotacao(t)["preco"]) for t in tickers])
    frac = np.array([eh_cripto(t) or rendafixa.eh_renda_fixa(t) for t in tickers])

    atual = q0 * precos
    total = atual.sum() + aporte
    alvo = w * total
    falta = np.maximum(alvo - atual, 0)
    if falta.sum() > aporte:
        falta *= aporte / falta.sum()
    compra = np.where(frac, falta / precos, np.floor(falta / precos))
    caixa = aporte - float(compra @ precos)
    desvio = lambda c: float(np.sum((atual + c * precos - alvo) ** 2))
    while True:  # cota a cota com a sobra
        atual_d, melhor = desvio(compra), None
        for i in np.where(~frac & (precos <= caixa + 1e-9))[0]:
            c = compra.copy()
            c[i] += 1
            d = desvio(c)
            if d < atual_d - 1e-9 and (melhor is None or d < melhor[0]):
                melhor = (d, i)
        if melhor is None:
            break
        compra[melhor[1]] += 1
        caixa -= precos[melhor[1]]
    # sobra pequena volta para os fracionários abaixo do alvo
    if caixa > 0.01 and frac.any():
        resto = np.where(frac, np.maximum(alvo - atual - compra * precos, 0), 0)
        if resto.sum() > 0:
            extra = np.minimum(resto, caixa * resto / resto.sum())
            compra += np.where(frac, extra / precos, 0)
            caixa -= float(extra.sum())
    compra = np.where(frac, np.floor(compra * 1e8) / 1e8, compra)
    depois = atual + compra * precos
    peso = lambda v: v / v.sum() if v.sum() else v * 0
    afast = lambda v: float(np.abs(peso(v) - w).sum() / 2 * 100)  # % da carteira fora do lugar
    return {
        "ativos": [
            {"ticker": t, "preco": round(float(precos[i]), 6), "fracionario": bool(frac[i]),
             "quantidade_atual": float(q0[i]), "valor_atual": round(float(atual[i]), 2),
             "peso_atual": round(float(peso(atual)[i]) * 100, 2), "peso_alvo": round(float(w[i]) * 100, 2),
             "comprar": float(compra[i]) if frac[i] else int(compra[i]), "valor_compra": round(float(compra[i] * precos[i]), 2),
             "peso_depois": round(float(peso(depois)[i]) * 100, 2)}
            for i, t in enumerate(tickers)
        ],
        "aporte": round(aporte, 2), "usado": round(aporte - caixa, 2), "sobra": round(caixa, 2),
        "fora_do_alvo_antes": round(afast(atual), 2) if atual.sum() else None,  # carteira vazia: não há "antes"
        "fora_do_alvo_depois": round(afast(depois), 2),
    }
