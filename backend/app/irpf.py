"""Apoio à declaração anual do IR (pessoa física) a partir das operações e dos proventos recebidos.

Por ano-calendário:
* Bens e Direitos — situação em 31/12 do ano anterior e do ano (quantidade na época e custo de aquisição pelo custo
  médio: o custo não muda com desdobramentos), com grupo/código sugeridos e a discriminação pronta;
* Rendimentos — proventos recebidos por ativo, separados em isentos (dividendos de ações, rendimentos de FII) e de
  tributação exclusiva (cupons do Tesouro); JCP não é separado dos dividendos pela fonte de dados;
* Renda variável — mês a mês: vendas, lucro isento (ações até R$ 20 mil/mês) e imposto/DARF.

Os códigos são sugestões a conferir no programa da Receita do ano; não substitui o informe da corretora.
"""
import pandas as pd

from . import impostos, rendafixa

CODIGOS = {  # (grupo, código, descrição)
    "ACAO": ("03", "01", "Ações (inclusive listadas em bolsa)"),
    "FII": ("07", "03", "Fundos imobiliários (FII)"),
    "ETF": ("07", "09", "Fundos de índice (ETF) — confira o código"),
    "EXTERIOR": ("04", "04", "BDRs e outros ativos negociados em bolsa — confira o código"),
    "CRIPTO": ("08", "02", "Criptoativos (Bitcoin: 08-01)"),
    "RF": ("04", "02", "Títulos públicos e privados sujeitos à tributação (Tesouro, CDB)"),
}


CUSTODIA = {"CRIPTO": "Mantido em corretora/carteira de criptoativos (informe CNPJ e nome).",
            "RF": "Custodiado na B3 (informe a instituição e o CNPJ do emissor/corretora)."}


def _fator_depois(eventos: list, data: pd.Timestamp) -> float:
    f = 1.0
    for d, x in eventos:
        if d > data:
            f *= x
    return f


def _posicoes_em(tx: list[dict], data: pd.Timestamp, eventos: dict) -> dict:
    """Quantidade (na base da época) e custo de aquisição de cada ativo no fim do dia `data`."""
    pos = {}
    for x in sorted(tx, key=lambda x: x["data"]):
        if x["data"] > data:
            break
        p = pos.setdefault(x["ticker"], {"q": 0.0, "custo": 0.0})
        if x["sinal"] > 0:
            p["q"] += x["q"]
            p["custo"] += 0.0 if x["evento"] == "desdobro" else x["q"] * x["p"]
        else:
            q = min(x["q"], p["q"])
            medio = p["custo"] / p["q"] if p["q"] else 0.0
            p["q"] -= q
            if not x["evento"]:
                p["custo"] -= medio * q
    out = {}
    for t, p in pos.items():
        if p["q"] > 1e-9:
            # tx estão na base atual: desfaz os desdobramentos posteriores à data para ter a quantidade da época
            out[t] = {"quantidade": p["q"] / _fator_depois(eventos.get(t, []), data), "custo": p["custo"]}
    return out


def _fmt(v: float) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def relatorio(tx: list[dict], recebidos: list[dict], ir_mensal: dict, eventos: dict) -> dict:
    if not tx:
        return {}
    anos = range(min(x["data"].year for x in tx), pd.Timestamp.today().year + 1)
    classes = {t: impostos.classe(t) for t in {x["ticker"] for x in tx}}
    out = {}
    for ano in anos:
        fim, ant = pd.Timestamp(ano, 12, 31), pd.Timestamp(ano - 1, 12, 31)
        agora, antes = _posicoes_em(tx, fim, eventos), _posicoes_em(tx, ant, eventos)
        bens = []
        for t in sorted(set(agora) | set(antes)):
            classe = classes[t]
            g, c, desc = CODIGOS.get(classe, CODIGOS["ACAO"])
            q = agora.get(t, {}).get("quantidade", 0.0)
            custo = agora.get(t, {}).get("custo", 0.0)
            nome = rendafixa.nome(t) if rendafixa.eh_renda_fixa(t) else t
            qtd = f"{q:.8f}".rstrip("0").rstrip(".") if classe in ("CRIPTO", "RF") else f"{q:.0f}"
            disc = (f"{qtd} {'unidades' if classe in ('CRIPTO', 'RF') else 'cotas' if classe in ('FII', 'ETF') else 'ações'} de {nome}"
                    f", custo médio de R$ {_fmt(custo / q if q else 0)} por unidade. {CUSTODIA.get(classe, 'Custodiado na B3.')}" if q > 1e-9
                    else f"{nome}: posição zerada em {ano}.")
            bens.append({"ticker": t, "classe": impostos.NOMES.get(classe, classe), "grupo": g, "codigo": c, "descricao_codigo": desc,
                         "quantidade": round(q, 8), "situacao_anterior": round(antes.get(t, {}).get("custo", 0.0), 2),
                         "situacao_atual": round(custo, 2), "discriminacao": disc})
        rend = {}
        for r in recebidos:
            if not r["data"].startswith(str(ano)):
                continue
            classe = classes.get(r["ticker"], "ACAO")
            if rendafixa.eh_tesouro(r["ticker"]):
                tipo = "Tributação exclusiva — juros de títulos (cupons do Tesouro; IR retido na fonte)"
            elif classe == "FII":
                tipo = "Isentos — rendimentos de FII"
            elif classe == "ACAO":
                tipo = "Isentos — lucros e dividendos (JCP, se houver, vai em tributação exclusiva: confira o informe)"
            else:
                tipo = "Confira o informe — proventos de ETF/BDR/exterior"
            k = (tipo, r["ticker"])
            rend[k] = rend.get(k, 0.0) + r["valor"]
        rendimentos = [{"tipo": k[0], "ticker": k[1], "valor": round(v, 2)} for k, v in sorted(rend.items())]
        meses = [m for m in ir_mensal.get("meses", []) if m["mes"].startswith(str(ano))]
        if not (bens or rendimentos or meses):
            continue
        out[str(ano)] = {
            "em_curso": ano == pd.Timestamp.today().year,
            "bens": bens, "rendimentos": rendimentos, "renda_variavel": meses,
            "totais": {
                "bens_anterior": round(sum(b["situacao_anterior"] for b in bens), 2),
                "bens_atual": round(sum(b["situacao_atual"] for b in bens), 2),
                "rendimentos_isentos": round(sum(r["valor"] for r in rendimentos if r["tipo"].startswith("Isentos")), 2),
                "tributacao_exclusiva": round(sum(r["valor"] for r in rendimentos if r["tipo"].startswith("Tributação")), 2),
                "lucro_isento_acoes": round(sum(m["isento"] for m in meses), 2),
                "darf": round(sum(m["darf"] for m in meses), 2),
            },
        }
    return out
