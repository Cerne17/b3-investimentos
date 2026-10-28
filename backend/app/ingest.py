"""Carga dos CSVs da B3 + coleta de métricas (Yahoo Finance e informe mensal CVM).

Uso:
    python -m app.ingest                  # carrega CSVs, coleta Yahoo e CVM
    python -m app.ingest --only fii       # só fundos imobiliários
    python -m app.ingest --skip-yahoo     # só CSVs (+ CVM)
    python -m app.ingest --skip-cvm       # sem o informe CVM
    python -m app.ingest --only acao      # só ações (lista do Formulário Cadastral da CVM)
    python -m app.ingest --pendentes      # só ativos que ainda não têm dados do Yahoo
    python -m app.ingest --only cripto    # só criptomoedas (CoinGecko + Yahoo), --limit = quantas moedas
"""
import argparse
import csv
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import cripto, cvm
from .db import ROOT, colunas, connect, init_db
from .yahoo import coletar_metricas

DATA_DIR = Path(os.getenv("B3_DATA_DIR", ROOT / "data"))
CSV_ETF = DATA_DIR / "etfsListados.csv"
CSV_FII = DATA_DIR / "fundosListados.csv"

ETF_CATEGORIAS = [
    ("Cripto", ["BITCOIN", "CRIPTO", "ETHER", "BLOCKCHAIN", "SOLANA", "XRP", "HASH", "COIN", "WEB3", "DEFI"]),
    ("Renda Fixa", ["RENDA FIXA", "TESOURO", "IMA-", "IMAB", "IRF-M", "IRFM", "IPCA", "DEBÊNTURE", "DEBENTURE",
                    "CRÉDITO", "CREDITO", "PRÉ", "TÍTULOS PÚBLICOS", "SELIC", "DI ", "T-BILL", "TREASURY"]),
    ("Commodities", ["OURO", "GOLD", "PRATA", "SILVER", "PETRÓLEO", "OIL", "AGRO", "COMMOD", "CARBONO", "URÂNIO", "URANIO", "NUCLEAR", "FUTURO DE", "MILHO", "BOI GORDO", "RARE EARTH", "METALS"]),
    ("Internacional", ["S&P", "SP500", "NASDAQ", "MSCI", "EUA", "USA", "WORLD", "GLOBAL", "CHINA", "ACWI", "EUROPA",
                       "EMERG", "DOW JONES", "INTERNACIONAL", "NYSE", "RUSSELL", "DÓLAR", "DOLAR", "ARGENTIN", "JAPAN",
                       "JAPÃO", "ÍNDIA", "INDIA", "FTSE", "STOXX", "US ", "AMERICA", "SEMICOND", "WISDOMTREE", "INTERNATIONAL", "NEOS", "NASD", "TECH", "ALL COUNTRIES", "EXTERIOR", "®US", "HEALTHCARE"]),
]


def categoria_etf(razao: str) -> str:
    r = f" {razao.upper()} "
    for nome, chaves in ETF_CATEGORIAS:
        if any(k in r for k in chaves):
            return nome
    return "Ações Brasil"


def ler_csv(path: Path) -> list[dict]:
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.reader(f, delimiter=";")
        next(reader)
        return [
            {"razao_social": r[0].strip(), "nome_pregao": r[1].strip(), "codigo": r[2].strip().upper()}
            for r in reader if len(r) >= 3 and r[2].strip()
        ]


def carregar_csvs() -> None:
    init_db()
    sql = """INSERT INTO {t} (codigo, razao_social, nome_pregao, categoria)
             VALUES (:codigo, :razao_social, :nome_pregao, :categoria)
             ON CONFLICT(codigo) DO UPDATE SET razao_social=excluded.razao_social,
             nome_pregao=excluded.nome_pregao, categoria={cat}"""
    with connect() as conn:
        for row in ler_csv(CSV_ETF):
            conn.execute(sql.format(t="etfs", cat="excluded.categoria"), {**row, "categoria": categoria_etf(row["razao_social"])})
        for row in ler_csv(CSV_FII):
            conn.execute(sql.format(t="fundos", cat="COALESCE(fundos.categoria, excluded.categoria)"), {**row, "categoria": cvm.categoria({}, row["razao_social"])})


def carregar_acoes() -> int:
    """Lista de ações/units da CVM -> tabela acoes (não há CSV da B3 para ações)."""
    init_db()
    print("[acoes] baixando Formulário Cadastral e cadastro de companhias da CVM...", flush=True)
    lista = cvm.carregar_acoes()
    cols = ["codigo", "empresa", "razao_social", "nome_pregao", "categoria", "tipo_acao", "acoes_por_unit",
            "segmento_listagem", "cnpj", "controle_acionario"]
    upd = ", ".join(f"{c}=excluded.{c}" for c in cols[1:])
    with connect() as conn:
        conn.executemany(
            f"INSERT INTO acoes ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)}) "
            f"ON CONFLICT(codigo) DO UPDATE SET {upd}",
            lista,
        )
    print(f"[acoes] {len(lista)} ações/units cadastradas.", flush=True)
    return len(lista)


TIPO_TABELA = {"etfs": "ETF", "fundos": "FII", "acoes": "ACAO"}


def salvar(tabela: str, codigo: str, dados: dict) -> None:
    validas = set(colunas(tabela)) - {"codigo", "razao_social", "nome_pregao", "categoria", "empresa", "tipo_acao",
                                      "acoes_por_unit", "segmento_listagem", "cnpj", "controle_acionario"}
    if tabela == "acoes" and dados.get("status") == "ok":
        avisos = [dados.get("alerta") or ""]
        if (dados.get("dividend_yield") or 0) > 25:
            avisos.append("DY 12m acima de 25%: pode incluir provento extraordinário.")
        if (dados.get("liquidez_media") or 0) < 10000:
            avisos.append("Baixa liquidez (< R$ 10 mil/dia).")
        dados["alerta"] = " ".join(a for a in avisos if a) or None
    cols = [c for c in dados if c in validas]
    # FII: VP/cota da CVM tem prioridade sobre o Yahoo; não sobrescreve com NULL
    if tabela == "fundos":
        preservar = ("valor_patrimonial", "pvp", "cotas_emitidas", "valor_mercado")
        cols = [c for c in cols if not (c in preservar and dados[c] is None)]
    with connect() as conn:
        if cols:
            conn.execute(
                f"UPDATE {tabela} SET {', '.join(f'{c}=?' for c in cols)} WHERE codigo=?",
                [dados[c] for c in cols] + [codigo],
            )
        conn.executemany(
            "INSERT OR REPLACE INTO proventos (codigo, tipo, data, valor) VALUES (?, ?, ?, ?)",
            [(codigo, TIPO_TABELA[tabela], d, v) for d, v in dados.get("proventos", [])],
        )
    if tabela == "fundos":
        recalcular_fii(codigo)


def recalcular_fii(codigo: str | None = None) -> None:
    """P/VP e campos derivados combinando preço (Yahoo) com VP/cota (CVM)."""
    filtro, args = ("WHERE codigo=?", [codigo]) if codigo else ("", [])
    with connect() as conn:
        conn.execute(
            f"""UPDATE fundos SET
                pvp = CASE WHEN preco > 0 AND valor_patrimonial > 0 THEN ROUND(preco / valor_patrimonial, 4) ELSE pvp END,
                valor_mercado = COALESCE(valor_mercado, preco * cotas_emitidas),
                liquidez_media = COALESCE(liquidez_media, volume_medio * preco)
            {filtro}""",
            args,
        )
        conn.execute(
            f"""UPDATE fundos SET alerta = NULLIF(TRIM(
                CASE WHEN dividend_yield > 25 AND (dy_12m_cvm IS NULL OR ABS(dividend_yield - dy_12m_cvm) > 10)
                     THEN 'DY do Yahoo diverge da CVM (possível provento/grupamento não ajustado). ' ELSE '' END ||
                CASE WHEN pvp IS NOT NULL AND (pvp > 3 OR pvp < 0.1) THEN 'P/VP fora do usual. ' ELSE '' END ||
                CASE WHEN status = 'ok' AND COALESCE(liquidez_media, 0) < 10000 THEN 'Baixa liquidez (< R$ 10 mil/dia).' ELSE '' END
            ), '') {filtro}""",
            args,
        )


def por_unit(codigo: str) -> int:
    with connect(readonly=True) as conn:
        r = conn.execute("SELECT acoes_por_unit FROM acoes WHERE codigo=?", [codigo]).fetchone()
    return (r["acoes_por_unit"] if r else None) or 1


def atualizar(tabela: str, codigo: str, tentativas: int = 4) -> dict:
    for i in range(tentativas):
        try:
            dados = coletar_metricas(codigo, TIPO_TABELA[tabela], por_unit(codigo) if tabela == "acoes" else 1)
            break
        except Exception as e:
            if "Too Many Requests" not in str(e) or i == tentativas - 1:
                raise
            time.sleep(15 * (i + 1))  # backoff do rate limit do Yahoo
    salvar(tabela, codigo, dados)
    return dados


def coletar(tabela: str, workers: int = 8, pendentes: bool = False, limit: int | None = None) -> None:
    with connect() as conn:
        sql = f"SELECT codigo FROM {tabela}" + (" WHERE status != 'ok'" if pendentes else "")
        codigos = [r["codigo"] for r in conn.execute(sql)][:limit]
    total, ok = len(codigos), 0
    print(f"[{tabela}] coletando {total} ativos no Yahoo Finance...", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(atualizar, tabela, c): c for c in codigos}
        for i, fut in enumerate(as_completed(futs), 1):
            c = futs[fut]
            try:
                status = fut.result()["status"]
                ok += status == "ok"
            except Exception as e:  # rede/rate limit: segue com os demais
                status = f"erro: {e}"
            if i % 25 == 0 or i == total:
                print(f"  {i}/{total} ({ok} com dados) - último: {c} {status}", flush=True)


def aplicar_cvm() -> int:
    print("[cvm] baixando informe mensal de FIIs...", flush=True)
    dados = cvm.carregar()
    validas = set(colunas("fundos"))
    n = 0
    with connect() as conn:
        fundos = {r["codigo"]: r["razao_social"] for r in conn.execute("SELECT codigo, razao_social FROM fundos")}
        for codigo, d in dados.items():
            if codigo not in fundos:
                continue
            d = dict(d)
            cotas = d.pop("cotas_cvm", None)
            d["categoria"] = cvm.categoria(d, fundos[codigo])
            cols = [c for c in d if c in validas]
            conn.execute(
                f"UPDATE fundos SET {', '.join(f'{c}=?' for c in cols)}, "
                "cotas_emitidas = COALESCE(cotas_emitidas, ?) WHERE codigo=?",
                [d[c] for c in cols] + [cotas, codigo],
            )
            n += 1
    recalcular_fii()
    print(f"[cvm] {n} FIIs enriquecidos com dados da CVM.", flush=True)
    return n


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", choices=["etf", "fii", "acao", "cripto"])
    p.add_argument("--skip-yahoo", action="store_true")
    p.add_argument("--skip-cvm", action="store_true")
    p.add_argument("--pendentes", action="store_true")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit", type=int)
    a = p.parse_args()

    if a.only == "cripto":
        cripto.coletar(a.limit or 150)
        return
    carregar_csvs()
    print("CSVs carregados.", flush=True)
    if a.only in (None, "acao"):
        carregar_acoes()
    if not a.skip_cvm and a.only in (None, "fii"):
        aplicar_cvm()
    if a.skip_yahoo:
        return
    if a.only in (None, "etf"):
        coletar("etfs", a.workers, a.pendentes, a.limit)
    if a.only in (None, "fii"):
        coletar("fundos", a.workers, a.pendentes, a.limit)
    if a.only in (None, "acao"):
        coletar("acoes", a.workers, a.pendentes, a.limit)
    if a.only is None:
        cripto.coletar()


if __name__ == "__main__":
    main()
