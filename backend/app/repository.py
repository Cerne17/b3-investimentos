"""Consultas ao SQLite — usadas pela API REST e pelo servidor MCP."""
import re
import sqlite3
from statistics import median

from .db import TABELAS, colunas, connect

TIPOS = {"etf": "etfs", "etfs": "etfs", "fii": "fundos", "fiis": "fundos", "fundo": "fundos", "fundos": "fundos",
         "acao": "acoes", "acoes": "acoes", "ação": "acoes", "ações": "acoes"}


def tabela_de(tipo: str) -> str:
    try:
        return TIPOS[tipo.lower()]
    except KeyError:
        raise ValueError(f"tipo inválido: {tipo!r} (use 'etf', 'fii' ou 'acao')")


def numericas(tabela: str) -> list[str]:
    return [c for c, t, _ in TABELAS[tabela] if t.startswith(("REAL", "INTEGER"))]


def textuais(tabela: str) -> list[str]:
    return [c for c, t, _ in TABELAS[tabela] if t.startswith("TEXT")]


def dicionario() -> dict:
    return {
        t: [{"coluna": c, "tipo": "numero" if tp.startswith(("REAL", "INTEGER")) else "texto", "descricao": d}
            for c, tp, d in cols]
        for t, cols in TABELAS.items()
    }


def listar(
    tipo: str,
    busca: str | None = None,
    categoria: str | None = None,
    segmento: str | None = None,
    faixas: dict[str, tuple[float | None, float | None]] | None = None,
    igual: dict[str, str] | None = None,
    somente_com_dados: bool = True,
    ordenar: str | None = None,
    ordem: str = "desc",
    limite: int = 50,
    offset: int = 0,
    campos: list[str] | None = None,
) -> dict:
    """Lista ETFs ou FIIs com filtros. `faixas` = {coluna: (min, max)} para qualquer coluna numérica."""
    tabela = tabela_de(tipo)
    cols_ok = set(colunas(tabela))
    where, args = [], []
    if somente_com_dados:
        where.append("status = 'ok'")
    if busca:
        where.append("(norm(codigo) LIKE norm(?) OR norm(ticker) LIKE norm(?) OR norm(razao_social) LIKE norm(?) OR norm(nome_pregao) LIKE norm(?))")
        args += [f"%{busca}%"] * 4
    if categoria:
        where.append("categoria = ? COLLATE NOCASE")
        args.append(categoria)
    if segmento:
        if tabela == "etfs":
            raise ValueError("segmento não existe para ETFs")
        # FIIs: segmento de atuação (CVM); ações: segmento de listagem (Novo Mercado, Nível 2...)
        where.append(f"{'segmento' if tabela == 'fundos' else 'segmento_listagem'} = ? COLLATE NOCASE")
        args.append(segmento)
    for col, valor in (igual or {}).items():
        if col not in cols_ok:
            raise ValueError(f"coluna desconhecida: {col}")
        where.append(f"{col} = ? COLLATE NOCASE")
        args.append(valor)
    nums = set(numericas(tabela))
    for col, (mn, mx) in (faixas or {}).items():
        if col not in nums:
            raise ValueError(f"coluna numérica desconhecida: {col}")
        if mn is not None:
            where.append(f"{col} >= ?")
            args.append(mn)
        if mx is not None:
            where.append(f"{col} <= ?")
            args.append(mx)

    ordenar = ordenar or ("dividend_yield" if tabela == "fundos" else "liquidez_media")
    if ordenar not in cols_ok:
        raise ValueError(f"coluna de ordenação desconhecida: {ordenar}")
    direcao = "ASC" if ordem.lower() == "asc" else "DESC"
    sel = ", ".join(c for c in (campos or colunas(tabela)) if c in cols_ok) or "*"
    cond = f"WHERE {' AND '.join(where)}" if where else ""

    with connect(readonly=True) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM {tabela} {cond}", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT {sel} FROM {tabela} {cond} ORDER BY {ordenar} IS NULL, {ordenar} {direcao} LIMIT ? OFFSET ?",
            args + [min(limite, 1000), offset],
        ).fetchall()
    return {"total": total, "limite": limite, "offset": offset, "itens": [dict(r) for r in rows]}


def obter(tipo: str, codigo: str) -> dict | None:
    tabela = tabela_de(tipo)
    codigo = codigo.upper().replace(".SA", "")
    if tabela != "acoes":
        codigo = re.sub(r"\d+$", "", codigo)  # aceita HGLG11 ou HGLG; ações usam o ticker completo (PETR4)
    with connect(readonly=True) as conn:
        row = conn.execute(f"SELECT * FROM {tabela} WHERE codigo = ?", [codigo]).fetchone()
        if not row:
            return None
        provs = conn.execute(
            "SELECT data, valor FROM proventos WHERE codigo = ? ORDER BY data DESC LIMIT 36", [codigo]
        ).fetchall()
    return {**dict(row), "proventos_recentes": [dict(p) for p in provs]}


def proventos(codigo: str, limite: int = 120) -> list[dict]:
    codigo = codigo.upper().replace(".SA", "")
    with connect(readonly=True) as conn:
        q = "SELECT data, valor, tipo FROM proventos WHERE codigo = ? ORDER BY data DESC LIMIT ?"
        rows = conn.execute(q, [codigo, limite]).fetchall() or conn.execute(q, [re.sub(r"\d+$", "", codigo), limite]).fetchall()
    return [dict(r) for r in rows]


def buscar(q: str, limite: int = 15) -> list[dict]:
    """Autocomplete em ETFs e FIIs (código, ticker ou nome)."""
    like = f"%{q}%"
    with connect(readonly=True) as conn:
        rows = conn.execute(
            """SELECT tipo, codigo, ticker, nome_pregao, razao_social, categoria, preco, liquidez_media, status FROM ativos
               WHERE norm(codigo) LIKE norm(?) OR norm(ticker) LIKE norm(?) OR norm(nome_pregao) LIKE norm(?)
                  OR norm(razao_social) LIKE norm(?)
               ORDER BY status = 'ok' DESC, (codigo LIKE ?) DESC, liquidez_media IS NULL, liquidez_media DESC LIMIT ?""",
            [like, like, like, like, f"{q}%", limite],
        ).fetchall()
    return [dict(r) for r in rows]


def comparar(codigos: list[str]) -> list[dict]:
    out = []
    for c in codigos:
        for tipo in ("acao", "etf", "fii"):
            r = obter(tipo, c)
            if r:
                r.pop("proventos_recentes", None)
                out.append({"tipo": tipo.upper(), **r})
                break
    return out


def valores_distintos(tipo: str, coluna: str) -> list[dict]:
    tabela = tabela_de(tipo)
    if coluna not in textuais(tabela):
        raise ValueError(f"coluna textual desconhecida: {coluna}")
    with connect(readonly=True) as conn:
        return [dict(r) for r in conn.execute(
            f"SELECT {coluna} AS valor, COUNT(*) AS quantidade FROM {tabela} WHERE {coluna} IS NOT NULL "
            f"GROUP BY {coluna} ORDER BY quantidade DESC")]


def _estatisticas(valores: list[float]) -> dict | None:
    v = [x for x in valores if x is not None]
    if not v:
        return None
    return {"mediana": round(median(v), 4), "media": round(sum(v) / len(v), 4), "min": min(v), "max": max(v), "n": len(v)}


def resumo() -> dict:
    """Visão geral: contagens e estatísticas por categoria."""
    metr = {
        "etfs": ["dividend_yield", "pl", "retorno_12m", "volatilidade_12m", "liquidez_media"],
        "fundos": ["dividend_yield", "pvp", "retorno_total_12m", "liquidez_media", "alavancagem"],
        "acoes": ["pl", "pvp", "roe", "dividend_yield", "retorno_total_12m", "margem_liquida", "ev_ebitda", "liquidez_media"],
    }
    out = {}
    with connect(readonly=True) as conn:
        for tabela, cols in metr.items():
            rows = [dict(r) for r in conn.execute(f"SELECT * FROM {tabela}")]
            ok = [r for r in rows if r["status"] == "ok"]
            cats: dict[str, list] = {}
            for r in ok:
                cats.setdefault(r["categoria"] or "—", []).append(r)
            out[tabela] = {
                "total": len(rows),
                "com_dados": len(ok),
                "ultima_atualizacao": max((r["atualizado_em"] or "" for r in rows), default=None),
                "geral": {c: _estatisticas([r[c] for r in ok]) for c in cols},
                "por_categoria": {
                    cat: {"quantidade": len(rs), **{c: _estatisticas([r[c] for r in rs]) for c in cols}}
                    for cat, rs in sorted(cats.items(), key=lambda kv: -len(kv[1]))
                },
            }
    return out


_SQL_PROIBIDO = re.compile(r"\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b", re.I)


def sql_somente_leitura(query: str, limite: int = 500) -> dict:
    """Executa um SELECT arbitrário em conexão somente leitura."""
    q = query.strip().rstrip(";")
    if ";" in q or not re.match(r"^\s*(select|with)\b", q, re.I) or _SQL_PROIBIDO.search(q):
        raise ValueError("Apenas uma instrução SELECT/WITH é permitida.")
    with connect(readonly=True) as conn:
        conn.execute("PRAGMA query_only = ON")
        try:
            cur = conn.execute(q)
        except sqlite3.Error as e:
            raise ValueError(f"Erro SQL: {e}")
        cols = [d[0] for d in cur.description or []]
        rows = cur.fetchmany(limite)
    return {"colunas": cols, "linhas": [list(r) for r in rows], "quantidade": len(rows), "truncado": len(rows) == limite}
