import numpy as np
import pandas as pd
import pytest

from app import montecarlo, portfolio, rendafixa


# ---------- estimativas robustas ----------

def test_ledoit_wolf_e_james_stein():
    rng = np.random.default_rng(0)
    R = rng.normal(0.0005, 0.01, size=(300, 5))
    cov, k = portfolio.ledoit_wolf(R)
    assert 0 <= k <= 1
    assert np.all(np.linalg.eigvalsh(cov) > 0)
    m, c = portfolio.james_stein(R, cov, 0.0005, 252)
    assert 0 <= c <= 1 and m.shape == (5,)


# ---------- onde aportar ----------

def test_aportar_so_compra_e_respeita_o_aporte(monkeypatch):
    precos = {"MXRF11": 10.0, "BOVA11": 150.0, "CDI": 9.0}
    monkeypatch.setattr(portfolio, "cotacao", lambda t: {"preco": precos[t]})
    r = portfolio.aportar(["MXRF11", "BOVA11", "CDI"], [0.3, 0.3, 0.4], [300, 0, 100], 1000)
    compras = {a["ticker"]: a["comprar"] for a in r["ativos"]}
    assert compras["MXRF11"] == 0  # já acima do alvo: não compra (e nunca vende)
    assert isinstance(compras["BOVA11"], int) and compras["BOVA11"] > 0
    assert r["usado"] <= 1000 + 1e-6 and r["sobra"] >= -1e-6
    assert r["fora_do_alvo_depois"] < r["fora_do_alvo_antes"]


def test_aportar_carteira_vazia_sem_antes(monkeypatch):
    monkeypatch.setattr(portfolio, "cotacao", lambda t: {"preco": 10.0})
    r = portfolio.aportar(["A", "B"], [0.5, 0.5], None, 100)
    assert r["fora_do_alvo_antes"] is None and [a["comprar"] for a in r["ativos"]] == [5, 5]


# ---------- Monte Carlo com retornos constantes (resultado exato) ----------

@pytest.fixture
def constante(monkeypatch):
    """Carteira de um ativo que rende exatamente 1% ao mês (21 pregões), sem proventos."""
    diario = 1.01 ** (1 / 21) - 1
    idx = pd.bdate_range("2020-01-01", periods=600)
    R = pd.DataFrame({"X": np.full(600, diario)}, index=idx)
    monkeypatch.setattr(montecarlo, "retornos_alinhados", lambda t, p: (R[t], [None] * len(t), 252))
    monkeypatch.setattr(montecarlo, "proventos_alinhados", lambda t, s, R_: R_ * 0)
    return diario


def test_patrimonio_e_saque_seguro_exatos(constante):
    r = montecarlo.simular_carteira(["X"], None, 10000, 0, 1, 200, "bootstrap", benchmark=None)
    assert r["final"]["p50"] == pytest.approx(10000 * 1.01 ** 12, rel=1e-3)
    # aposentadoria: 120 meses sacando de um patrimônio que rende 1% a.m. → saque máximo = anuidade
    r = montecarlo.simular_carteira(["X"], None, 100000, 0, 1, 200, "bootstrap", benchmark=None, anos_saque=10, saque_mensal=500)
    v0, i, n = 100000 * 1.01 ** 12, 0.01, 120
    anuidade = v0 * i / (1 - (1 + i) ** -n)
    assert r["aposentadoria"]["saque_seguro"]["90"] == pytest.approx(anuidade, rel=5e-3)
    assert r["aposentadoria"]["prob_sucesso"] == 100


def test_aporte_necessario_e_ir(constante):
    r = montecarlo.simular_carteira(["X"], None, 0, 1000, 5, 200, "bootstrap", meta=100000, benchmark=None)
    fator = sum(1.01 ** k for k in range(60))  # aportes no fim de cada mês
    assert r["meta"]["aporte_necessario"]["50"] == pytest.approx(100000 / fator, rel=5e-3)


def test_meta_de_renda_sem_proventos_e_inalcancavel(constante):
    r = montecarlo.simular_carteira(["X"], None, 1000, 100, 2, 200, meta=100, meta_tipo="renda", benchmark=None)
    assert r["meta"]["aporte_necessario"]["50"] is None and r["renda"]["final"]["p50"] == 0


# ---------- renda fixa ----------

def test_tickers_de_renda_fixa():
    for t in ("CDI", "CDI-110", "SELIC", "IPCA+6", "IPCA+6.5", "PRE-13", "TD-IPCA-2035", "TD-PREJ-2031"):
        assert rendafixa.eh_renda_fixa(t), t
    for t in ("PETR4", "BTC-BRL", "IPCA", "TD-XYZ-2030"):
        assert not rendafixa.eh_renda_fixa(t), t
    assert rendafixa.ticker_tesouro("Tesouro IPCA+ com Juros Semestrais 2045", "") == "TD-IPCAJ-2045"
    assert rendafixa.ticker_tesouro("Tesouro Prefixado", "2031-01-01") == "TD-PRE-2031"
    assert rendafixa.ticker_tesouro("Tesouro Renda+ Aposentadoria Extra 2059", "") == "TD-RENDA-2059"


def test_indice_prefixado_e_cdi(monkeypatch):
    dias = pd.bdate_range("2024-01-01", periods=253)
    cdi = pd.Series(0.05, index=dias)  # 0,05% ao dia
    monkeypatch.setattr(rendafixa, "_sgs", lambda nome: cdi)
    monkeypatch.setattr(rendafixa, "_cache", {})
    pre = rendafixa.indice("PRE-13")
    assert pre.iloc[-1] == pytest.approx(1.13, rel=1e-9)  # 252 dias úteis depois da base
    cdi110 = rendafixa.indice("CDI-110")
    assert cdi110.iloc[-1] == pytest.approx((1 + 0.0005 * 1.1) ** 252, rel=1e-9)
