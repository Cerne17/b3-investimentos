import pandas as pd
import pytest

from app import impostos, irpf

T = lambda d, t, s, q, p, e=None: {"data": pd.Timestamp(d), "ticker": t, "sinal": s, "q": q, "p": p, "evento": e}


@pytest.fixture(autouse=True)
def classes(monkeypatch):
    monkeypatch.setattr(impostos, "classe", lambda t: {"MXRF11": "FII", "BTC-BRL": "CRIPTO"}.get(t, "ACAO"))


def test_bens_em_31_12_com_custo_e_quantidade_da_epoca():
    # desdobramento 1:2 em 2025 (Yahoo): as operações já vêm na base atual (200 cotas a R$ 5)
    tx = [T("2024-03-01", "PETR4", 1, 200, 5.0), T("2025-02-03", "PETR4", -1, 100, 6.0), T("2025-01-10", "MXRF11", 1, 100, 9.5)]
    eventos = {"PETR4": [(pd.Timestamp("2025-01-15"), 2.0)]}
    r = irpf.relatorio(tx, [{"data": "2025-03-01", "ticker": "MXRF11", "valor": 10.0}, {"data": "2025-04-01", "ticker": "PETR4", "valor": 20.0}],
                       {"meses": [{"mes": "2025-02", "isento": 100.0, "imposto": 0, "darf": 0}]}, eventos)
    b24 = {b["ticker"]: b for b in r["2024"]["bens"]}
    assert b24["PETR4"]["quantidade"] == 100  # na época eram 100 ações (antes do desdobramento)
    assert b24["PETR4"]["situacao_atual"] == 1000 and b24["PETR4"]["grupo"] == "03"
    b25 = {b["ticker"]: b for b in r["2025"]["bens"]}
    assert b25["PETR4"]["situacao_anterior"] == 1000 and b25["PETR4"]["situacao_atual"] == 500
    assert b25["MXRF11"]["grupo"] + b25["MXRF11"]["codigo"] == "0703"
    t = r["2025"]["totais"]
    assert t["rendimentos_isentos"] == 30 and t["lucro_isento_acoes"] == 100
