"""Informe mensal de FIIs da CVM (dados.cvm.gov.br): VP/cota, PL, cotistas, segmento, composição."""
import io
import zipfile
from datetime import date

import httpx
import pandas as pd

URL = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"

SEG_TIJOLO = {"Logística", "Shoppings", "Escritórios", "Residencial", "Hospital", "Varejo", "Hotel",
              "Educacional", "Lajes Corporativas"}
PAPEL = ["CRI", "CRI_CRA", "LCI", "LCI_LCA", "Letras_Hipotecarias", "LIG"]


def _baixar(ano: int) -> dict[str, pd.DataFrame]:
    r = httpx.get(URL.format(ano=ano), timeout=120, follow_redirects=True)
    r.raise_for_status()
    out = {}
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        for nome in z.namelist():
            chave = next(k for k in ("geral", "complemento", "ativo_passivo") if k in nome)
            out[chave] = pd.read_csv(z.open(nome), sep=";", encoding="latin-1", decimal=".", low_memory=False)
    return out


def _f(v):
    return None if pd.isna(v) else float(v)


def carregar() -> dict[str, dict]:
    """Retorna {codigo_4_letras: {colunas da tabela fundos}} com o informe mais recente de cada fundo."""
    ano = date.today().year
    anos = []
    for a in (ano - 1, ano):
        try:
            anos.append(_baixar(a))
        except httpx.HTTPError:
            pass
    if not anos:
        return {}
    tab = {k: pd.concat([a[k] for a in anos if k in a], ignore_index=True) for k in ("geral", "complemento", "ativo_passivo")}
    for df in tab.values():
        df.sort_values(["CNPJ_Fundo_Classe", "Data_Referencia", "Versao"], inplace=True)

    comp = tab["complemento"].drop_duplicates(["CNPJ_Fundo_Classe", "Data_Referencia"], keep="last")
    ultimo_comp = comp.groupby("CNPJ_Fundo_Classe").tail(1).set_index("CNPJ_Fundo_Classe")
    ultimo_ap = tab["ativo_passivo"].groupby("CNPJ_Fundo_Classe").tail(1).set_index("CNPJ_Fundo_Classe")
    geral = tab["geral"].groupby("CNPJ_Fundo_Classe").tail(1)

    # acumulados de 12 meses (percentuais vêm em fração ao mês)
    ultimo_mes = pd.to_datetime(comp.groupby("CNPJ_Fundo_Classe")["Data_Referencia"].transform("max"))
    c12 = comp[pd.to_datetime(comp["Data_Referencia"]) > ultimo_mes - pd.DateOffset(months=12)]
    acum = lambda s: (float((1 + s.fillna(0)).prod()) - 1) * 100
    g = c12.groupby("CNPJ_Fundo_Classe")
    dy12 = g["Percentual_Dividend_Yield_Mes"].sum() * 100
    rent_ef = g["Percentual_Rentabilidade_Efetiva_Mes"].apply(acum)
    rent_pat = g["Percentual_Rentabilidade_Patrimonial_Mes"].apply(acum)
    taxa = g["Percentual_Despesas_Taxa_Administracao"].mean() * 12 * 100

    out: dict[str, dict] = {}
    for _, row in geral.iterrows():
        isin = str(row.get("Codigo_ISIN") or "")
        if len(isin) < 6 or not isin.startswith("BR"):
            continue
        codigo, cnpj = isin[2:6], row["CNPJ_Fundo_Classe"]
        c = ultimo_comp.loc[cnpj] if cnpj in ultimo_comp.index else None
        a = ultimo_ap.loc[cnpj] if cnpj in ultimo_ap.index else None
        d = {
            "cnpj": cnpj,
            "segmento": row.get("Segmento_Atuacao") if isinstance(row.get("Segmento_Atuacao"), str) else None,
            "mandato": row.get("Mandato") if isinstance(row.get("Mandato"), str) else None,
            "tipo_gestao": row.get("Tipo_Gestao") if isinstance(row.get("Tipo_Gestao"), str) else None,
            "publico_alvo": row.get("Publico_Alvo") if isinstance(row.get("Publico_Alvo"), str) else None,
            "administrador": row.get("Nome_Administrador") if isinstance(row.get("Nome_Administrador"), str) else None,
            "data_funcionamento": row.get("Data_Funcionamento") if isinstance(row.get("Data_Funcionamento"), str) else None,
        }
        if c is not None:
            ativo = _f(c["Valor_Ativo"])
            pl = _f(c["Patrimonio_Liquido"])
            d.update(
                data_ref_cvm=c["Data_Referencia"],
                valor_ativo=ativo,
                patrimonio_liquido=pl,
                cotas_cvm=_f(c["Cotas_Emitidas"]),
                valor_patrimonial=round(_f(c["Valor_Patrimonial_Cotas"]), 4) if _f(c["Valor_Patrimonial_Cotas"]) else None,
                cotistas=int(c["Total_Numero_Cotistas"]) if not pd.isna(c["Total_Numero_Cotistas"]) else None,
                alavancagem=round((ativo - pl) / ativo * 100, 2) if ativo and pl is not None else None,
                dy_12m_cvm=round(float(dy12.get(cnpj)), 2) if cnpj in dy12 else None,
                rentab_efetiva_12m=round(rent_ef.get(cnpj), 2) if cnpj in rent_ef else None,
                rentab_patrimonial_12m=round(rent_pat.get(cnpj), 2) if cnpj in rent_pat else None,
                taxa_adm_anual=round(float(taxa.get(cnpj)), 3) if cnpj in taxa and not pd.isna(taxa.get(cnpj)) else None,
            )
            if a is not None and ativo:
                pct = lambda v: round((_f(v) or 0) / ativo * 100, 2)
                d.update(
                    pct_imoveis=pct(a.get("Direitos_Bens_Imoveis")),
                    pct_papel=pct(sum((_f(a.get(k)) or 0) for k in PAPEL)),
                    pct_fii=pct(a.get("FII")),
                    pct_liquidez=pct(a.get("Total_Necessidades_Liquidez")),
                )
        # se houver mais de uma classe com o mesmo código, fica a de maior PL
        if codigo not in out or (d.get("patrimonio_liquido") or 0) > (out[codigo].get("patrimonio_liquido") or 0):
            out[codigo] = d
    return out


def categoria(d: dict, razao_social: str) -> str:
    """Tijolo / Papel / FoF / Híbrido pela composição do ativo; cai na razão social se não houver informe."""
    imo, pap, fii = (d.get(k) or 0 for k in ("pct_imoveis", "pct_papel", "pct_fii"))
    if imo + pap + fii >= 20:
        if pap >= 50:
            return "Papel"
        if fii >= 50:
            return "FoF"
        if imo >= 50:
            return "Tijolo"
        return "Híbrido"
    if d.get("segmento") in SEG_TIJOLO:
        return "Tijolo"
    r = razao_social.upper()
    if "FUNDO DE FUNDOS" in r:
        return "FoF"
    if "RECEB" in r or " CRI" in r or "CRÉDITO" in r:
        return "Papel"
    return "Híbrido" if "MULTIESTRAT" in r else "Tijolo"


# ---------- ações (Formulário Cadastral + cadastro de companhias abertas) ----------

URL_FCA = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_{ano}.zip"
URL_CAD = "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv"
TICKER_ACAO = r"^[A-Z0-9]{4}(3|4|5|6|7|8|11)$"
def acoes_por_unit(composicao: str) -> int:
    """'1 ON / 2 PN' -> 3; '1 KLBN3 + 4 KLBN4' -> 5; ignora recibos de subscrição."""
    import re
    n = sum(int(m) for m in re.findall(r"(\d+)\s*(?=ON|PN|a[cç][aã]o|a[cç][oõ]es|[A-Z]{4}\d)", composicao, re.I))
    return n or 1


TIPOS_ACAO = {"Ações Ordinárias": "ON", "Ações Preferenciais": "PN", "Units": "Unit"}


def carregar_acoes() -> list[dict]:
    """Ações e units negociadas na B3: ticker, empresa, tipo, segmento de listagem, setor e controle."""
    frames = []
    for ano in (date.today().year - 1, date.today().year):
        try:
            r = httpx.get(URL_FCA.format(ano=ano), timeout=120, follow_redirects=True)
            r.raise_for_status()
        except httpx.HTTPError:
            continue
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            nome = next(n for n in z.namelist() if "valor_mobiliario" in n)
            frames.append(pd.read_csv(z.open(nome), sep=";", encoding="latin-1", dtype=str))
    if not frames:
        return []
    vm = pd.concat(frames, ignore_index=True).fillna("")
    vm["Codigo_Negociacao"] = vm["Codigo_Negociacao"].str.strip().str.upper()
    vm = vm[(vm["Mercado"] == "Bolsa") & vm["Valor_Mobiliario"].isin(TIPOS_ACAO) & (vm["Data_Fim_Negociacao"] == "")
            & vm["Codigo_Negociacao"].str.match(TICKER_ACAO)]
    vm = vm.sort_values(["Data_Referencia", "Versao"]).drop_duplicates("Codigo_Negociacao", keep="last")

    cad = pd.read_csv(io.BytesIO(httpx.get(URL_CAD, timeout=120).content), sep=";", encoding="latin-1", dtype=str).fillna("")
    cad = cad.sort_values("SIT").drop_duplicates("CNPJ_CIA", keep="first").set_index("CNPJ_CIA")  # ATIVO antes de CANCELADA

    out = []
    for _, r in vm.iterrows():
        c = cad.loc[r["CNPJ_Companhia"]] if r["CNPJ_Companhia"] in cad.index else None
        if c is not None and c["SIT"] not in ("ATIVO", "FASE OPERACIONAL", ""):
            continue
        tipo = TIPOS_ACAO[r["Valor_Mobiliario"]]
        if tipo == "PN" and r["Sigla_Classe_Acao_Preferencial"]:
            tipo = f"PN{r['Sigla_Classe_Acao_Preferencial'][-1]}"
        out.append({
            "codigo": r["Codigo_Negociacao"],
            "empresa": r["Codigo_Negociacao"][:4],
            "razao_social": r["Nome_Empresarial"],
            "nome_pregao": (c["DENOM_COMERC"] if c is not None and c["DENOM_COMERC"] else r["Nome_Empresarial"])[:60],
            "categoria": (c["SETOR_ATIV"] if c is not None else "") or None,
            "tipo_acao": tipo,
            "acoes_por_unit": acoes_por_unit(r["Composicao_BDR_Unit"]) if tipo == "Unit" else 1,
            "segmento_listagem": r["Segmento"] or None,
            "cnpj": r["CNPJ_Companhia"],
            "controle_acionario": (c["CONTROLE_ACIONARIO"] if c is not None else "") or None,
        })
    return out
