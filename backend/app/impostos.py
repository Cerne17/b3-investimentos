"""Imposto de renda (pessoa física) aproximado por classe de ativo, para simulações de longo prazo.

Alíquotas padrão (podem ser trocadas na chamada):
* ganho de capital — ações e ETFs de renda variável 15%, FIIs 20%, cripto 15%, BDR/exterior 15%,
  renda fixa 15% (tabela regressiva: 15% acima de 720 dias, o caso dos horizontes simulados);
* proventos — rendimentos de FII isentos, dividendos de ações isentos para o pequeno investidor (a retenção de 10%
  sobre dividendos vale só acima de R$ 50 mil por mês da mesma empresa), distribuições de ETF 15%.

Simplificações: a isenção de vendas de ações até R$ 20 mil/mês (e de cripto até R$ 35 mil/mês) não entra, o IR
sobre rebalanceamentos também não (só o resgate no fim), e JCP — 15% na fonte — não é separado dos dividendos.
"""
import re

from . import rendafixa
from .yahoo import eh_cripto

GANHO = {"ACAO": 0.15, "ETF": 0.15, "FII": 0.20, "CRIPTO": 0.15, "RF": 0.15, "EXTERIOR": 0.15}
PROVENTOS = {"ACAO": 0.0, "ETF": 0.15, "FII": 0.0, "CRIPTO": 0.0, "RF": 0.0, "EXTERIOR": 0.30}
NOMES = {"ACAO": "Ações", "ETF": "ETFs", "FII": "FIIs", "CRIPTO": "Cripto", "RF": "Renda fixa", "EXTERIOR": "Exterior"}


def classe(ticker: str) -> str:
    t = ticker.upper().strip().replace(".SA", "")
    if rendafixa.eh_renda_fixa(t):
        return "RF"
    if eh_cripto(t):
        return "CRIPTO"
    try:
        from . import repository as repo
        for tipo, nome in (("fii", "FII"), ("etf", "ETF"), ("acao", "ACAO")):
            if repo.obter(tipo, t):
                return nome
    except Exception:
        pass
    if re.fullmatch(r"[A-Z]{4}3[2-5]", t):  # BDRs
        return "EXTERIOR"
    if re.fullmatch(r"[A-Z]{4}11", t):
        return "FII"
    return "ACAO" if re.fullmatch(r"[A-Z0-9]{4}\d{1,2}", t) else "EXTERIOR"


def aliquotas(tickers: list[str], ganho: dict | None = None, proventos: dict | None = None) -> dict:
    g, p = {**GANHO, **(ganho or {})}, {**PROVENTOS, **(proventos or {})}
    cls = [classe(t) for t in tickers]
    return {"classes": cls, "ganho": [g[c] for c in cls], "proventos": [p[c] for c in cls],
            "tabela": {c: {"nome": NOMES[c], "ganho": g[c], "proventos": p[c]} for c in dict.fromkeys(cls)}}
