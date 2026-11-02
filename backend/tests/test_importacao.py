import base64
import json
import zlib

import pytest

from app import importacao, repository, yahoo


@pytest.fixture(autouse=True)
def base(monkeypatch):
    def buscar(q, limite=10):
        return [{"ticker": t, "codigo": c} for t, c in (("MXRF11", "MXRF"), ("PETR4", "PETR4"), ("BTC-BRL", "BTC")) if t.startswith(q.upper()[:3])][:limite]

    def cotacao(t):
        raise LookupError(t)

    monkeypatch.setattr(repository, "buscar", buscar)
    monkeypatch.setattr(yahoo, "cotacao", cotacao)


def _do_link(link):
    prefixo = importacao.SITE + "#broker?c="
    assert link.startswith(prefixo)
    b = link[len(prefixo):]
    return json.loads(zlib.decompress(base64.urlsafe_b64decode(b + "=" * (-len(b) % 4)), -15))


def test_transacoes_viram_link_e_json_ordenados():
    r = importacao.gerar("Minha é boa", transacoes=[
        {"data": "15/03/2024", "ticker": "mxrf11", "tipo": "venda", "quantidade": 10, "preco": 11},
        {"data": "2024-03-15", "ticker": "MXRF11.SA", "tipo": "compra", "quantidade": "100", "preco": "10,25"},
        {"data": "2024-04-01", "ticker": "cdi-110@Banco C6", "quantidade": 50, "preco": 9},
    ])
    assert r["ok"] and r["avisos"] == [] and r["ativos"] == ["MXRF11", "CDI-110@Banco C6"]
    assert [o["tipo"] for o in r["arquivo_json"]["transacoes"]] == ["compra", "venda", "compra"]
    assert _do_link(r["link"]) == ["Minha é boa", None, [
        ["2024-03-15", "MXRF11", "c", 100, 10.25], ["2024-03-15", "MXRF11", "v", 10, 11], ["2024-04-01", "CDI-110@Banco C6", "c", 50, 9]]]


def test_posicoes_entram_como_compra_de_hoje():
    r = importacao.gerar(posicoes=[{"ticker": "PETR4", "quantidade": 5, "preco_medio": 30}])
    assert r["ok"] and r["arquivo_json"] == {"nome": "Carteira importada", "posicoes": [{"ticker": "PETR4", "quantidade": 5, "preco_medio": 30}]}
    assert _do_link(r["link"])[2][0][1:] == ["PETR4", "c", 5, 30] and "data de hoje" in r["avisos"][0]


def test_erros_impedem_o_link_e_sugerem_ticker():
    r = importacao.gerar(transacoes=[
        {"data": "2024-03-15", "ticker": "MXRF", "tipo": "compra", "quantidade": 100, "preco": 10},
        {"data": "2099-01-01", "ticker": "PETR4", "tipo": "compra", "quantidade": 1, "preco": 30},
        {"data": "ontem", "ticker": "PETR4", "tipo": "doacao", "quantidade": 0, "preco": 0},
    ])
    texto = " ".join(r["erros"])
    assert not r["ok"] and "link" not in r
    for trecho in ("futuro", "data inválida", "tipo deve ser", "quantidade deve", "preço deve"):
        assert trecho in texto
    r = importacao.gerar(transacoes=[{"data": "2024-03-15", "ticker": "MXRF", "tipo": "compra", "quantidade": 100, "preco": 10}])
    assert r["erros"] == ["MXRF: ticker não encontrado. Quis dizer MXRF11?"]
    assert not importacao.gerar()["ok"] and not importacao.gerar(transacoes=[{}], posicoes=[{}])["ok"]


def test_venda_sem_posicao_avisa_e_evento_nao_exige_preco():
    r = importacao.gerar(transacoes=[
        {"data": "2024-01-02", "ticker": "PETR4", "tipo": "compra", "quantidade": 10, "preco": 30},
        {"data": "2024-02-01", "ticker": "PETR4", "tipo": "compra", "quantidade": 10, "preco": 0, "evento": "desdobro"},
        {"data": "2024-03-01", "ticker": "PETR4", "tipo": "venda", "quantidade": 25, "preco": 20},
    ])
    assert r["ok"] and len(r["avisos"]) == 1 and "maior que a posição" in r["avisos"][0]
    assert r["arquivo_json"]["transacoes"][1]["evento"] == "desdobro"


def test_ticker_fora_da_base_aceito_se_o_yahoo_cota(monkeypatch):
    monkeypatch.setattr(yahoo, "cotacao", lambda t: {"preco": 1.0})
    r = importacao.gerar(posicoes=[{"ticker": "AAPL34", "quantidade": 1, "preco_medio": 50}])
    assert r["ok"] and any("fora da base" in a for a in r["avisos"])


def test_codigo_de_ativo_da_base_nao_cai_no_ticker_homonimo_do_yahoo(monkeypatch):
    monkeypatch.setattr(yahoo, "cotacao", lambda t: {"preco": 30.0, "moeda": "USD"})
    r = importacao.gerar(posicoes=[{"ticker": "BTC", "quantidade": 1, "preco_medio": 50}])
    assert r["erros"] == ["BTC: ticker não encontrado. Quis dizer BTC-BRL?"]
    r = importacao.gerar(posicoes=[{"ticker": "AAPL", "quantidade": 1, "preco_medio": 50}])
    assert r["ok"] and any("cotado em USD" in a for a in r["avisos"])


def test_tesouro_inexistente_nao_sugere_ele_mesmo(monkeypatch):
    def cotacao(t):
        raise LookupError(t)

    monkeypatch.setattr(importacao.rendafixa, "cotacao", cotacao)
    monkeypatch.setattr(importacao.rendafixa, "buscar", lambda q: [{"ticker": q}, {"ticker": "TD-IPCA-2035"}])
    assert importacao.gerar(posicoes=[{"ticker": "TD-IPCA-1900", "quantidade": 1, "preco_medio": 50}])["erros"] == [
        "TD-IPCA-1900: ticker não encontrado. Quis dizer TD-IPCA-2035?"]
