"""Importa operações dos extratos da Área do Investidor da B3 (investidor.b3.com.br), em .xlsx ou .csv.

* Extrato de Negociação: "Data do Negócio", "Tipo de Movimentação" (Compra/Venda), "Código de Negociação",
  "Quantidade", "Preço".
* Extrato de Posição (uma aba por classe): o que a conta tem hoje, sem datas — vira posições de hoje para editar;
  CDB/LCI/LCA entram na data de emissão com a taxa (% do CDI, IPCA + x, prefixado) implícita no preço atualizado.
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


def _ler(conteudo: bytes, nome: str) -> dict[str, pd.DataFrame]:
    """Todas as abas (o extrato de Posição vem com uma aba por classe de ativo)."""
    if nome.lower().endswith(".csv"):
        texto = conteudo.decode("utf-8-sig", errors="replace")
        sep = ";" if texto.count(";") > texto.count(",") else ","
        return {"csv": pd.read_csv(io.StringIO(texto), sep=sep, dtype=str)}
    return pd.read_excel(io.BytesIO(conteudo), dtype=object, sheet_name=None)


def _taxa_implicita(familia: str, emissao: pd.Timestamp, fator: float) -> tuple[str, float] | None:
    """Ticker de renda fixa cujo índice cresce `fator` desde a emissão: % do CDI (DI), IPCA + x ou prefixado x."""
    from . import rendafixa
    modelo = {"DI": lambda x: "CDI" if abs(x - 100) < 0.05 else f"CDI-{x:g}", "IPCA": lambda x: f"IPCA+{x:g}", "PRE": lambda x: f"PRE-{x:g}"}[familia]
    faixa = {"DI": (50, 200), "IPCA": (0, 20), "PRE": (1, 40)}[familia]

    def crescimento(x):
        s = rendafixa.indice(modelo(round(x, 2)))
        base = s[s.index <= emissao]
        return float(s.iloc[-1] / (base.iloc[-1] if len(base) else s.iloc[0]))

    lo, hi = faixa
    if not (crescimento(lo) <= fator <= crescimento(hi)):
        return None
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if crescimento(mid) < fator else (lo, mid)
    x = round((lo + hi) / 2, 1)
    s = rendafixa.indice(modelo(x))
    base = s[s.index <= emissao]
    return modelo(x), float(base.iloc[-1] if len(base) else s.iloc[0])


def _posicao(abas: dict[str, pd.DataFrame]) -> dict:
    """Extrato de Posição: o que a conta tem hoje, sem datas nem preço pago. Ações, ETFs, FIIs e BDRs entram como
    compras de hoje ao preço de fechamento, marcadas como posição sem data real (para editar depois). Renda fixa
    registrada (CDB, LCI...) entra na data de emissão, com a taxa implícita no preço atualizado (PU inicial = 1)."""
    hoje = pd.Timestamp.today().strftime("%Y-%m-%d")
    transacoes, ignoradas, avisos = [], Counter(), []
    for aba, df in abas.items():
        df = df.copy()
        df.columns = [_norm(c) for c in df.columns]
        if "produto" not in df.columns:
            continue
        df = df[df["produto"].notna() & df["quantidade"].notna()] if "quantidade" in df.columns else df.iloc[0:0]
        for _, r in df.iterrows():
            q = _num(r.get("quantidade"))
            produto = str(r["produto"]).strip()
            if not q:
                continue
            if "codigo de negociacao" in df.columns and pd.notna(r.get("codigo de negociacao")):
                preco = _num(r.get("preco de fechamento")) or 0
                transacoes.append({"data": hoje, "ticker": _ticker(r["codigo de negociacao"]), "tipo": "compra",
                                   "quantidade": q, "preco": preco, "inicial": True})
            elif _norm(produto).startswith("tesouro"):
                tk = ticker_tesouro(produto, str(r.get("vencimento", "")))
                aplicado = _num(r.get("valor aplicado"))
                if not tk:
                    ignoradas[produto] += 1
                    continue
                transacoes.append({"data": hoje, "ticker": tk, "tipo": "compra", "quantidade": q,
                                   "preco": (aplicado / q) if aplicado else 0, "inicial": True})
            elif "indexador" in df.columns:
                idx = _norm(r.get("indexador", "")).upper()
                familia = "DI" if idx in ("DI", "CDI", "DI1") else "IPCA" if "IPCA" in idx else "PRE" if idx.startswith("PRE") else None
                pu = _num(r.get("preco atualizado curva")) or _num(r.get("preco atualizado mtm"))
                emissao = pd.to_datetime(r.get("data de emissao"), dayfirst=True, errors="coerce")
                achado = _taxa_implicita(familia, emissao, pu) if familia and pu and pd.notna(emissao) else None
                if not achado:
                    ignoradas[f"{produto} ({r.get('indexador')})"] += 1
                    continue
                tk, indice_emissao = achado
                valor = q * 1.0  # PU de emissão de CDB/LCI/LCA é R$ 1,00
                transacoes.append({"data": emissao.strftime("%Y-%m-%d"), "ticker": tk, "tipo": "compra",
                                   "quantidade": valor / indice_emissao, "preco": indice_emissao})
                reais = f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
                avisos.append(f"{produto}: R$ {reais} aplicados em {emissao:%d/%m/%Y} rendendo {tk.replace('.', ',')} "
                              "(taxa implícita no preço atualizado, supondo PU de emissão de R$ 1,00)")
            else:
                ignoradas[f"{aba}: {produto}"] += 1
    if any(t.get("inicial") for t in transacoes):
        avisos.insert(0, "Extrato de Posição não traz datas nem preço pago: ações, ETFs e FIIs entram com a data de hoje e o "
                         "preço de fechamento. Use Editar para pôr data e preço de cada compra, ou importe o extrato de "
                         "Negociação para o histórico completo.")
    return {"transacoes": transacoes, "ignoradas": dict(ignoradas.most_common()), "avisos": avisos, "formato": "posicao"}


def importar(arquivo_base64: str, nome: str = "extrato.xlsx") -> dict:
    try:
        abas = _ler(base64.b64decode(arquivo_base64), nome)
    except Exception as e:
        raise ValueError(f"Não consegui ler o arquivo ({e}). Exporte o extrato da B3 em Excel (.xlsx) ou CSV.")
    colunas = {c for df in abas.values() for c in map(_norm, df.columns)}
    if "preco de fechamento" in colunas or "valor atualizado curva" in colunas or (
            "valor aplicado" in colunas and "data do negocio" not in colunas):  # extrato de Posição
        return _posicao(abas)
    df = next(iter(abas.values()))
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
        raise ValueError("Formato não reconhecido: use o extrato de Negociação, Movimentação ou Posição da Área do Investidor da B3.")

    transacoes.sort(key=lambda t: t["data"])
    # venda sem compra antes dentro do extrato = posição de antes do período exportado
    saldo, antes = {}, set()
    for t in transacoes:
        q = saldo.get(t["ticker"], 0.0) + (t["quantidade"] if t["tipo"] == "compra" else -t["quantidade"])
        if q < -1e-9:
            antes.add(t["ticker"])
        saldo[t["ticker"]] = max(q, 0.0)
    if antes:
        inicio = pd.Timestamp(transacoes[0]["data"]).strftime("%d/%m/%Y")
        avisos.append(f"Vendas sem compra registrada no extrato ({', '.join(sorted(antes))}): o extrato começa em {inicio}. "
                      "Exporte um período maior para trazer as compras antigas — ou apague essas vendas.")
    sem_preco = sorted({t["ticker"] for t in transacoes if not t["preco"] and not t.get("evento")})
    if sem_preco:
        avisos.append("Operações sem preço (o custo fica zero): " + ", ".join(sem_preco))
    return {"transacoes": transacoes, "ignoradas": dict(ignoradas.most_common()), "avisos": avisos}
