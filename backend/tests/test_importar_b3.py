import base64
import io

import pandas as pd
import pytest

from app.importar_b3 import importar


def _b64_xlsx(df):
    b = io.BytesIO()
    df.to_excel(b, index=False)
    return base64.b64encode(b.getvalue()).decode()


def test_extrato_de_movimentacao():
    df = pd.DataFrame([
        ["Credito", "15/03/2025", "Transferência - Liquidação", "PETR4 - PETROBRAS", "XP", 100, "R$ 37,50", "3.750,00"],
        ["Debito", "10/06/2025", "Transferência - Liquidação", "PETR4F - PETROBRAS", "XP", 10, 40.1, 401],
        ["Credito", "01/07/2025", "Rendimento", "MXRF11 - MAXI RENDA", "XP", 100, 0.1, 10],
        ["Credito", "02/07/2025", "Desdobro", "ITSA4 - ITAUSA", "XP", 50, "-", "-"],
        ["Credito", "05/08/2025", "Bonificação em Ativos", "ITSA4 - ITAUSA", "XP", 5, "9,12", "45,60"],
        ["Credito", "05/08/2025", "Compra", "Tesouro IPCA+ 2035", "XP", 0.5, 2300, 1150],
        ["Debito", "05/09/2025", "Venda", "Tesouro IPCA+ 2035", "XP", 0.2, 2350, 470],
        ["Credito", "06/09/2025", "Transferência", "BBSE3 - BB SEGURIDADE", "XP", 10, "-", "-"],
    ], columns=["Entrada/Saída", "Data", "Movimentação", "Produto", "Instituição", "Quantidade", "Preço unitário", "Valor da Operação"])
    r = importar(_b64_xlsx(df), "movimentacao.xlsx")
    ops = r["transacoes"]
    assert [(o["ticker"], o["tipo"]) for o in ops] == [
        ("PETR4", "compra"), ("PETR4", "venda"), ("ITSA4", "compra"), ("ITSA4", "compra"),
        ("TD-IPCA-2035", "compra"), ("TD-IPCA-2035", "venda")]
    assert ops[0]["preco"] == 37.5 and ops[0]["data"] == "2025-03-15"
    assert ops[1]["ticker"] == "PETR4"  # mercado fracionário vira o ticker normal
    assert ops[2]["evento"] == "desdobro" and ops[3]["evento"] == "bonificacao"
    assert "evento" not in ops[4]
    assert r["ignoradas"] == {"rendimento": 1, "transferencia": 1}


def test_extrato_de_negociacao_csv():
    df = pd.DataFrame([["12/02/2025", "Compra", "Merc. Fracionário", "", "XP", "BBSE3F", 7, "34,50", "241,50"],
                       ["13/02/2025", "Venda", "Mercado à Vista", "", "XP", "WEGE3", 5, "50,10", "250,50"]],
                      columns=["Data do Negócio", "Tipo de Movimentação", "Mercado", "Prazo/Vencimento", "Instituição",
                               "Código de Negociação", "Quantidade", "Preço", "Valor"])
    arq = base64.b64encode(df.to_csv(index=False, sep=";").encode()).decode()
    ops = importar(arq, "negociacao.csv")["transacoes"]
    assert ops == [
        {"data": "2025-02-12", "ticker": "BBSE3", "tipo": "compra", "quantidade": 7.0, "preco": 34.5},
        {"data": "2025-02-13", "ticker": "WEGE3", "tipo": "venda", "quantidade": 5.0, "preco": 50.1},
    ]


def test_formato_desconhecido():
    arq = base64.b64encode(pd.DataFrame({"a": [1]}).to_csv(index=False).encode()).decode()
    with pytest.raises(ValueError, match="Formato não reconhecido"):
        importar(arq, "x.csv")


def test_extrato_de_posicao(monkeypatch):
    from app import rendafixa
    dias = pd.bdate_range("2024-01-01", "2026-10-28")
    monkeypatch.setattr(rendafixa, "_sgs", lambda nome: pd.Series(0.05, index=dias))
    monkeypatch.setattr(rendafixa, "_cache", {})
    fator = (1 + 0.0005 * 1.1) ** int(((dias > pd.Timestamp("2024-03-21"))).sum())  # 110% do CDI desde a emissão
    acoes = pd.DataFrame([["BBSE3 - BB SEGURIDADE", "XP", "1", "BBSE3", "x", "x", "ON", "x", 3, 3, "-", "-", 41.35, 124.05]],
                         columns=["Produto", "Instituição", "Conta", "Código de Negociação", "CNPJ da Empresa", "Código ISIN / Distribuição",
                                  "Tipo", "Escriturador", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo",
                                  "Preço de Fechamento", "Valor Atualizado"])
    rf = pd.DataFrame([["CDB - BANCO X", "X", "X", "CDB1", "DI", "REGISTRADO", "21/03/2024", "21/03/2028", 100, fator, 100 * fator],
                       [None] * 11],
                      columns=["Produto", "Instituição", "Emissor", "Código", "Indexador", "Tipo de regime", "Data de Emissão",
                               "Vencimento", "Quantidade", "Preço Atualizado CURVA", "Valor Atualizado CURVA"])
    b = io.BytesIO()
    with pd.ExcelWriter(b) as w:
        acoes.to_excel(w, sheet_name="Acoes", index=False)
        rf.to_excel(w, sheet_name="Renda Fixa", index=False)
    r = importar(base64.b64encode(b.getvalue()).decode(), "posicao.xlsx")
    acao, cdb = r["transacoes"]
    assert acao["ticker"] == "BBSE3" and acao["quantidade"] == 3 and acao["preco"] == 41.35 and acao["inicial"]
    assert cdb["ticker"] == "CDI-110" and cdb["data"] == "2024-03-21"
    assert cdb["quantidade"] * cdb["preco"] == pytest.approx(100)
