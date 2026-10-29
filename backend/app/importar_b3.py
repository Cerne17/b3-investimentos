"""Importa operações dos extratos da Área do Investidor da B3 (investidor.b3.com.br), em .xlsx ou .csv.

* Extrato de Negociação: "Data do Negócio", "Tipo de Movimentação" (Compra/Venda), "Código de Negociação",
  "Quantidade", "Preço".
* Extrato de Movimentação: "Entrada/Saída" (Credito/Debito), "Data", "Movimentação", "Produto", "Quantidade",
  "Preço unitário". Liquidações de compra/venda viram operações; bonificação, desdobro e grupamento viram eventos (sem
  dinheiro — o desempenho os descarta quando o Yahoo já ajustou os preços); títulos do Tesouro Direto viram TD-…
  (ex.: "Tesouro IPCA+ 2035" → TD-IPCA-2035) ao PU da operação. Proventos são recalculados pelo histórico e
  transferências entre corretoras não mudam a posição.
"""
import base64
import io
import re
import unicodedata
from collections import Counter

import pandas as pd

from .rendafixa import ticker_tesouro

COMPRA_VENDA = {"transferencia - liquidacao", "compra", "venda", "compra / venda", "liquidacao"}
SAIDA = {"leilao de fracao", "fracao em ativos"}
EVENTOS = {"bonificacao em ativos": "bonificacao", "desdobro": "desdobro", "grupamento": "grupamento"}
RESGATE_TD = {"venda", "resgate", "vencimento", "resgate antecipado", "compra / venda", "transferencia - liquidacao"}


def _norm(v) -> str:
    s = "".join(c for c in unicodedata.normalize("NFD", str(v)) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def _num(v) -> float | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s or s == "-":
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _ticker(produto: str) -> str:
    t = str(produto).split(" - ")[0].strip().upper()
    return t[:-1] if re.fullmatch(r"[A-Z]{4}\d{1,2}F", t) else t  # mercado fracionário: PETR4F → PETR4


def _data(v) -> str:
    return pd.to_datetime(v, dayfirst=True).strftime("%Y-%m-%d")


def _ler(conteudo: bytes, nome: str) -> pd.DataFrame:
    if nome.lower().endswith(".csv"):
        texto = conteudo.decode("utf-8-sig", errors="replace")
        sep = ";" if texto.count(";") > texto.count(",") else ","
        return pd.read_csv(io.StringIO(texto), sep=sep, dtype=str)
    return pd.read_excel(io.BytesIO(conteudo), dtype=object)


def importar(arquivo_base64: str, nome: str = "extrato.xlsx") -> dict:
    try:
        df = _ler(base64.b64decode(arquivo_base64), nome)
    except Exception as e:
        raise ValueError(f"Não consegui ler o arquivo ({e}). Exporte o extrato da B3 em Excel (.xlsx) ou CSV.")
    df.columns = [_norm(c) for c in df.columns]
    cols = set(df.columns)
    transacoes, ignoradas, avisos = [], Counter(), []

    if {"data do negocio", "codigo de negociacao"} <= cols:  # extrato de negociação
        for _, r in df.iterrows():
            tipo, q, p = _norm(r.get("tipo de movimentacao", "")), _num(r.get("quantidade")), _num(r.get("preco"))
            if tipo not in ("compra", "venda") or not q or pd.isna(r.get("data do negocio")):
                ignoradas[tipo or "linha vazia"] += 1
                continue
            transacoes.append({"data": _data(r["data do negocio"]), "ticker": _ticker(r["codigo de negociacao"]),
                               "tipo": tipo, "quantidade": q, "preco": p or 0})
    elif {"entrada/saida", "movimentacao", "produto"} <= cols:  # extrato de movimentação
        tesouro = set()
        for _, r in df.iterrows():
            mov, es = _norm(r.get("movimentacao", "")), _norm(r.get("entrada/saida", ""))
            q, p = _num(r.get("quantidade")), _num(r.get("preco unitario"))
            produto = str(r.get("produto", ""))
            if not q or pd.isna(r.get("data")):
                ignoradas[mov or "linha vazia"] += 1
                continue
            evento = None
            if _norm(produto).startswith("tesouro"):
                tk = ticker_tesouro(produto, "")
                if not tk:
                    tesouro.add(produto.strip())
                    continue
                if es.startswith("credito") and mov in COMPRA_VENDA:
                    tipo = "compra"
                elif es.startswith("debito") and mov in RESGATE_TD:
                    tipo = "venda"
                else:
                    ignoradas[mov] += 1
                    continue
                transacoes.append({"data": _data(r["data"]), "ticker": tk, "tipo": tipo, "quantidade": q, "preco": p or 0})
                continue
            if mov in COMPRA_VENDA:
                tipo = "compra" if es.startswith("credito") else "venda"
            elif mov in SAIDA and es.startswith("debito"):
                tipo = "venda"
            elif mov in EVENTOS:
                tipo, evento = ("compra" if es.startswith("credito") else "venda"), EVENTOS[mov]
            else:
                ignoradas[mov] += 1
                continue
            op = {"data": _data(r["data"]), "ticker": _ticker(produto), "tipo": tipo, "quantidade": q, "preco": p or 0}
            if evento:
                op["evento"] = evento
            transacoes.append(op)
        if tesouro:
            avisos.append("Títulos do Tesouro não reconhecidos (lance como TD-IPCA-2035, TD-PRE-2031...): " + ", ".join(sorted(tesouro)))
    else:
        raise ValueError("Formato não reconhecido: use o extrato de Negociação ou de Movimentação da Área do Investidor da B3.")

    transacoes.sort(key=lambda t: t["data"])
    sem_preco = sorted({t["ticker"] for t in transacoes if not t["preco"] and not t.get("evento")})
    if sem_preco:
        avisos.append("Operações sem preço (o custo fica zero): " + ", ".join(sem_preco))
    return {"transacoes": transacoes, "ignoradas": dict(ignoradas.most_common()), "avisos": avisos}
