import numpy as np
import pandas as pd
import pytest

from app import desempenho as dmod, impostos
from conftest import historico, pregoes

T = lambda d, t, s, q, p, e=None: {"data": pd.Timestamp(d), "ticker": t, "sinal": s, "q": q, "p": p, "evento": e}


@pytest.fixture(autouse=True)
def classes(monkeypatch):
    tabela = {"PETR4": "ACAO", "IVVB11": "ETF", "MXRF11": "FII", "BTC-BRL": "CRIPTO"}
    monkeypatch.setattr(impostos, "classe", lambda t: tabela.get(t, "ACAO"))


def test_isencao_de_acoes_ate_20_mil():
    _, ir = dmod._custo_medio_e_ir([T("2025-01-02", "PETR4", 1, 1000, 30), T("2025-02-03", "PETR4", -1, 500, 40)])
    m = ir["meses"][0]
    assert m["vendas"] == {"Ações": 20000.0} and m["isento"] == 5000.0 and m["imposto"] == 0


def test_acoes_acima_de_20_mil_pagam_15():
    _, ir = dmod._custo_medio_e_ir([T("2025-01-02", "PETR4", 1, 1000, 30), T("2025-02-03", "PETR4", -1, 600, 40)])
    assert ir["meses"][0]["imposto"] == pytest.approx(6000 * 0.15)
    assert ir["total_darf"] == pytest.approx(900)


def test_prejuizo_de_etf_compensa_lucro_tributavel_e_nao_o_isento():
    ops = [T("2025-01-02", "PETR4", 1, 2000, 30), T("2025-03-03", "IVVB11", 1, 10, 300), T("2025-04-01", "IVVB11", -1, 10, 250),
           T("2025-05-02", "PETR4", -1, 400, 45), T("2025-06-02", "PETR4", -1, 1000, 40)]
    _, ir = dmod._custo_medio_e_ir(ops)
    abril, maio, junho = ir["meses"]
    assert abril["prejuizo_acumulado"]["comum"] == 500
    assert maio["isento"] == 6000 and maio["prejuizo_acumulado"]["comum"] == 500  # lucro isento não consome prejuízo
    assert junho["imposto"] == pytest.approx((10000 - 500) * 0.15)


def test_fii_20_e_darf_minimo_acumula():
    _, ir = dmod._custo_medio_e_ir([T("2025-01-02", "MXRF11", 1, 100, 10), T("2025-02-03", "MXRF11", -1, 10, 13)])
    m = ir["meses"][0]
    assert m["imposto"] == pytest.approx(30 * 0.20) and m["darf"] == 0 and ir["a_pagar_acumulado"] == pytest.approx(6)


def test_custo_medio_e_grupamento():
    pos, ir = dmod._custo_medio_e_ir([T("2025-01-02", "PETR4", 1, 100, 10), T("2025-02-02", "PETR4", 1, 100, 20),
                                      T("2025-03-02", "PETR4", -1, 50, 10, "grupamento")])
    assert pos == [{"ticker": "PETR4", "quantidade": 150.0, "preco_medio": 20.0}]  # mesmo custo total, menos cotas
    assert ir["meses"] == []


def test_proventos_seguem_as_cotas_de_cada_data_ex(mercado):
    idx = pregoes("2025-01-02", 250)
    divs = np.zeros(250)
    divs[[20, 100, 200]] = 0.10  # três datas ex
    mercado["MXRF11"] = historico(np.full(250, 10.0), divs, index=idx)
    tx = [{"data": idx[0].date().isoformat(), "ticker": "MXRF11", "quantidade": 100, "preco": 10},
          {"data": idx[150].date().isoformat(), "ticker": "MXRF11", "quantidade": 200, "preco": 10}]
    r = dmod.desempenho(tx, benchmarks=[])
    assert [p["quantidade"] for p in r["proventos_recebidos"]] == [300, 100, 100]
    assert r["totais"]["proventos"] == pytest.approx(10 + 10 + 30)
    assert r["totais"]["twr"] == pytest.approx(3.0, abs=0.05)  # preço parado: só os 3 proventos de 1%


def test_compra_na_data_ex_nao_recebe(mercado):
    idx = pregoes("2025-01-02", 60)
    divs = np.zeros(60)
    divs[30] = 0.5
    mercado["MXRF11"] = historico(np.full(60, 10.0), divs, index=idx)
    r = dmod.desempenho([{"data": idx[30].date().isoformat(), "ticker": "MXRF11", "quantidade": 100, "preco": 10}], benchmarks=[])
    assert r["totais"]["proventos"] == 0


def test_operacao_antes_de_desdobramento_vai_para_base_atual(mercado):
    idx = pregoes("2025-01-02", 100)
    splits = np.zeros(100)
    splits[50] = 2.0  # Yahoo já ajustou os preços: antes do desdobro o histórico mostra metade
    mercado["ITSA4"] = historico(np.full(100, 10.0), splits=splits, index=idx)
    tx = [{"data": idx[0].date().isoformat(), "ticker": "ITSA4", "quantidade": 100, "preco": 20},
          {"data": idx[50].date().isoformat(), "ticker": "ITSA4", "quantidade": 100, "preco": 0, "evento": "desdobro"}]
    r = dmod.desempenho(tx, benchmarks=[])
    assert r["posicoes"] == [{"ticker": "ITSA4", "quantidade": 200.0, "preco_medio": 10.0}]
    assert any("já está nos preços" in a for a in r["avisos"])  # o desdobro lançado não duplica as cotas
    assert r["totais"]["valor"] == pytest.approx(2000)
