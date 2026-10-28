"""Criptomoedas: lista e dados de mercado do CoinGecko + histórico do Yahoo Finance, tudo convertido para reais.

O CoinGecko dá o universo (maiores por valor de mercado), oferta, FDV e máxima histórica; o Yahoo dá o histórico
diário do par em dólar, que vira reais pelo câmbio de cada dia. Métricas anualizadas usam 365 dias (cripto negocia
todos os dias) e não passam pelo ajuste de desdobramentos (saltos de 60% num dia acontecem de verdade).
"""
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import httpx
import pandas as pd
import yfinance as yf

from .db import colunas, connect, init_db
from .yahoo import FX, TAXA_LIVRE_RISCO, _num, metricas_preco

COINGECKO = "https://api.coingecko.com/api/v3/coins/markets"

# Classificação manual dos principais ativos; o resto cai em heurísticas (stablecoin, wrapped/staking) ou "Outros".
CATEGORIAS = {
    "Reserva de valor": ["BTC", "BCH", "LTC", "BSV", "ZEC", "XMR", "DASH", "KAS"],
    "Plataforma (L1)": ["ETH", "SOL", "ADA", "AVAX", "TRX", "TON", "SUI", "APT", "NEAR", "DOT", "ATOM", "ALGO", "HBAR", "ICP",
                        "SEI", "TIA", "INJ", "EGLD", "XTZ", "FTM", "S", "KAIA", "FLOW", "ETC", "VET", "EOS", "NEO", "QNT",
                        "XDC", "BERA", "HYPE", "MON", "IP", "CORE", "ROSE", "MINA", "KAVA", "CFX", "IOTA", "XEC", "ONE"],
    "Pagamentos": ["XRP", "XLM", "HBAR", "ALGO", "XDC", "PI", "WLFI"],
    "Layer 2 / escalabilidade": ["POL", "MATIC", "ARB", "OP", "MNT", "IMX", "STX", "STRK", "ZK", "LRC", "SKL", "METIS", "MERL", "CELO"],
    "DeFi": ["UNI", "AAVE", "MKR", "SKY", "LDO", "CRV", "ONDO", "ENA", "JUP", "PENDLE", "RAY", "CAKE", "COMP", "SNX", "1INCH",
             "DYDX", "GMX", "SUSHI", "MORPHO", "ETHFI", "AERO", "RUNE", "JTO", "SYRUP", "EIGEN", "USUAL", "FLUID", "VIRTUAL", "ASTER"],
    "Infraestrutura / oráculos": ["LINK", "PYTH", "GRT", "FIL", "AR", "RENDER", "RNDR", "TAO", "FET", "THETA", "HNT", "AKT",
                                  "W", "ZRO", "WLD", "JASMY", "IO", "ATH", "KAITO", "ICP"],
    "Token de corretora": ["BNB", "LEO", "OKB", "CRO", "BGB", "GT", "KCS", "HT", "MX", "WBT", "NEXO", "FTT"],
    "Meme": ["DOGE", "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "TRUMP", "PENGU", "SPX", "FARTCOIN", "BRETT", "POPCAT", "MOG",
             "NEIRO", "TURBO", "PNUT", "MEW", "BOME", "DOGS", "PUMP", "BABYDOGE", "MEME"],
    "Games / metaverso": ["SAND", "MANA", "AXS", "GALA", "APE", "ENJ", "ILV", "BEAM", "RON", "GMT"],
    "Lastreada em ouro": ["XAUT", "PAXG", "KAU"],
}
_EXTRAS = {
    "Plataforma (L1)": ["CC", "FLR", "GRAM", "XPL", "HASH", "NIGHT", "PLUME", "KAS"],
    "DeFi": ["JST", "SUN", "OHM", "LIT", "DRV", "FF", "CRV", "RSR", "LQTY", "BAL", "YFI"],
    "Infraestrutura / oráculos": ["GNO", "BTT", "GRASS", "VVV", "KITE", "API3", "BAND", "ANKR", "STORJ"],
    "Token de corretora": ["HTX", "BTW"],
    "Meme": ["M"],
}
for _nome, _syms in _EXTRAS.items():
    CATEGORIAS[_nome] = CATEGORIAS[_nome] + _syms
_CAT = {}
for _nome, _syms in CATEGORIAS.items():
    for _s in _syms:
        _CAT.setdefault(_s, _nome)

ESTAVEIS = {"USDT", "USDC", "DAI", "USDE", "USDS", "FDUSD", "TUSD", "PYUSD", "USDD", "FRAX", "USD1", "RLUSD", "BUSD",
            "USDX", "USDTB", "USDF", "USDG", "GHO", "LUSD", "SUSDE", "SUSDS", "BUIDL", "USYC", "USDO", "USR", "USDAI", "EURC"}
DERIVADOS = ("wrapped", "staked", "liquid staking", "restaked", "bridged", "wbtc", "steth", "cbbtc", "weeth", "reth",
             "jitosol", "msol", "bnsol", "lbtc", "solvbtc", "tbtc", "rseth", "ezeth", "meth", "oseth", "sweth")


RWA = ("fund", "treasury", "t-bill", "government", "money market", "clo ", "yield", "securities")


def categoria(c: dict) -> str:
    sym, nome = c["symbol"].upper(), (c.get("name") or "").lower()
    if any(k in nome + " " for k in RWA) or sym in ("BUIDL", "USYC", "USDY", "OUSG", "USTB", "JTRSY", "JAAA", "YLDS"):
        return "Ativo tokenizado (RWA)"
    if "gold" in nome and sym not in _CAT:
        return "Lastreada em ouro"
    if sym in ESTAVEIS or (("usd" in sym.lower() or "usd" in nome or "dollar" in nome) and abs((c.get("current_price") or 0) - 1) < 0.05):
        return "Stablecoin"
    if any(k in nome or k == sym.lower() for k in DERIVADOS):
        return "Derivativo (wrapped/staking)"
    return _CAT.get(sym, "Outros")


def listar_coingecko(n: int = 150) -> list[dict]:
    out, pagina = [], 1
    while len(out) < n:
        por = min(250, n - len(out))
        for tentativa in range(4):
            r = httpx.get(COINGECKO, params={"vs_currency": "usd", "order": "market_cap_desc", "per_page": por,
                                             "page": pagina, "price_change_percentage": "24h,7d"}, timeout=30)
            if r.status_code != 429:
                break
            time.sleep(20 * (tentativa + 1))
        r.raise_for_status()
        lote = r.json()
        if not lote:
            break
        out += lote
        pagina += 1
    # o CoinGecko às vezes repete símbolos (ex.: duas moedas "ZK"); fica a de maior valor de mercado
    vistos, unicos = set(), []
    for c in out:
        s = c["symbol"].upper()
        if s not in vistos and s.isascii() and s.replace(".", "").isalnum():
            vistos.add(s)
            unicos.append(c)
    return unicos


def _fx_hist() -> pd.Series:
    fx = yf.Ticker(FX).history(period="2y")["Close"].dropna()
    fx.index = fx.index.tz_localize(None).normalize()
    return fx


def _resolver(c: dict) -> tuple[str | None, pd.DataFrame | None]:
    """Acha o par em dólar no Yahoo cujo preço bate com o CoinGecko (símbolos repetidos ganham sufixo numérico,
    ex.: HYPE32196-USD)."""
    preco = c.get("current_price")
    candidatos = [f"{c['symbol'].upper()}-USD"]
    for _ in range(2):
        for sym in candidatos:
            h = yf.Ticker(sym).history(period="2y", auto_adjust=False)
            close = h["Close"].dropna() if not h.empty else []
            if len(close) and preco and abs(float(close.iloc[-1]) / preco - 1) < 0.15:
                return sym, h
        busca = []
        for termo in (f"{c['name'].split('(')[0].strip()} USD", f"{c['symbol'].upper()} USD"):
            try:
                busca += yf.Search(termo, max_results=8).quotes
            except Exception:
                pass
        candidatos = list(dict.fromkeys(q["symbol"] for q in busca if q.get("quoteType") == "CRYPTOCURRENCY"
                                        and q["symbol"].endswith("-USD") and q["symbol"] not in candidatos))
        if not candidatos:
            break
    return None, None


def coletar_uma(c: dict, fx: pd.Series, btc: pd.Series | None, taxa: float) -> dict:
    sym = c["symbol"].upper()
    p_usd = _num(c.get("current_price"))
    mcap, vol, fdv = _num(c.get("market_cap")), _num(c.get("total_volume")), _num(c.get("fully_diluted_valuation"))
    circ, maxs = _num(c.get("circulating_supply")), _num(c.get("max_supply"))
    dados = {
        "codigo": sym, "ticker": f"{sym}-BRL", "razao_social": c.get("name") or sym, "nome_pregao": c.get("name"),
        "categoria": categoria(c), "coingecko_id": c.get("id"), "rank_mercado": c.get("market_cap_rank"),
        "preco_usd": p_usd, "valor_mercado_usd": mcap, "volume_24h_usd": vol,
        "volume_mcap": round(vol / mcap * 100, 2) if vol and mcap else None,
        "variacao_24h": _num(c.get("price_change_percentage_24h_in_currency") or c.get("price_change_percentage_24h")),
        "variacao_7d": _num(c.get("price_change_percentage_7d_in_currency")),
        "ath_usd": _num(c.get("ath")), "dist_ath": _num(c.get("ath_change_percentage")),
        "data_ath": (c.get("ath_date") or "")[:10] or None,
        "oferta_circulante": circ, "oferta_total": _num(c.get("total_supply")), "oferta_maxima": maxs,
        "pct_emitido": round(circ / maxs * 100, 2) if circ and maxs else None,
        "fdv_usd": fdv, "mcap_fdv": round(mcap / fdv * 100, 2) if mcap and fdv else None,
        "preco": p_usd * taxa if p_usd else None,
        "valor_mercado": mcap * taxa if mcap else None,
        "cotas_emitidas": circ,
        "liquidez_media": vol * taxa if vol else None,
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    yahoo, h = _resolver(c)
    dados["yahoo_symbol"] = yahoo
    if h is None:
        dados["status"] = "sem_dados"
        return dados

    h = h.copy()
    h.index = h.index.tz_localize(None).normalize()
    usd_close = h["Close"].dropna()
    taxa_dia = fx.reindex(fx.index.union(h.index)).sort_index().ffill().bfill().reindex(h.index)
    for col in ("Open", "High", "Low", "Close"):
        h[col] = h[col] * taxa_dia
    h["Dividends"] = 0.0
    m = metricas_preco(h, dados["preco"], ajustar=False, dias_ano=365)
    for k in ("proventos", "splits", "proventos_12m", "dividend_yield", "num_proventos_12m", "ultimo_rendimento",
              "data_ultimo_rend", "crescimento_proventos"):
        m.pop(k, None)
    dados.update(m)
    dados["volume_medio"] = _num(h["Volume"].tail(30).mean())

    # Sortino e correlação/beta com o BTC (em dólar, para não misturar o efeito do câmbio)
    um_ano = h["Close"][h.index >= h.index[-1] - pd.Timedelta(days=365)]
    r = um_ano.pct_change().dropna()
    if len(r) > 60:
        rf_d = (1 + TAXA_LIVRE_RISCO) ** (1 / 365) - 1
        down = math.sqrt(float((r - rf_d).clip(upper=0).pow(2).mean())) * math.sqrt(365)
        ret = (float(um_ano.iloc[-1] / um_ano.iloc[0]) - 1) if len(um_ano) > 300 else None
        dados["sortino_12m"] = round((ret - TAXA_LIVRE_RISCO) / down, 2) if ret is not None and down else None
    if btc is not None and sym != "BTC":
        ru = usd_close[usd_close.index >= usd_close.index[-1] - pd.Timedelta(days=365)].pct_change().dropna()
        j = pd.concat([ru, btc], axis=1, join="inner").dropna()
        if len(j) > 60:
            dados["correlacao_btc"] = round(float(j.corr().iloc[0, 1]), 3)
            dados["beta_btc"] = round(float(j.cov().iloc[0, 1] / j.iloc[:, 1].var()), 3)
    elif sym == "BTC":
        dados["correlacao_btc"], dados["beta_btc"] = 1.0, 1.0

    avisos = []
    if dados["categoria"] == "Stablecoin" and p_usd and abs(p_usd - 1) > 0.02:
        avisos.append(f"Stablecoin fora da paridade (US$ {p_usd:.3f}).")
    if dados["volume_mcap"] is not None and dados["volume_mcap"] < 0.5:
        avisos.append("Giro baixo (volume 24h < 0,5% do valor de mercado).")
    if dados.get("mcap_fdv") is not None and dados["mcap_fdv"] < 50:
        avisos.append("Mais da metade da oferta ainda será emitida (valor de mercado < 50% do FDV).")
    if len(usd_close) < 330:
        avisos.append("Histórico curto no Yahoo (< 1 ano): métricas de 12 meses ausentes.")
    dados["alerta"] = " ".join(avisos) or None
    dados["status"] = "ok"
    return dados


def salvar(lista: list[dict]) -> None:
    validas = colunas("criptos")
    with connect() as conn:
        for d in lista:
            cols = [c for c in validas if c in d]
            upd = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "codigo")
            conn.execute(f"INSERT INTO criptos ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
                         f"ON CONFLICT(codigo) DO UPDATE SET {upd}", [d[c] for c in cols])


def recategorizar() -> None:
    """Reaplica a classificação sem recoletar (após editar as listas acima)."""
    with connect() as conn:
        for r in conn.execute("SELECT codigo, nome_pregao, preco_usd FROM criptos").fetchall():
            conn.execute("UPDATE criptos SET categoria=? WHERE codigo=?",
                         [categoria({"symbol": r["codigo"], "name": r["nome_pregao"], "current_price": r["preco_usd"]}), r["codigo"]])


def coletar(n: int = 150, workers: int = 6) -> int:
    init_db()
    print(f"[cripto] baixando as {n} maiores criptomoedas do CoinGecko...", flush=True)
    lista = listar_coingecko(n)
    fx = _fx_hist()
    taxa = float(fx.iloc[-1])
    b = yf.Ticker("BTC-USD").history(period="2y")["Close"].dropna()
    b.index = b.index.tz_localize(None).normalize()
    btc = b[b.index >= b.index[-1] - pd.Timedelta(days=365)].pct_change().dropna()
    print(f"[cripto] {len(lista)} moedas; USD/BRL = {taxa:.4f}. Coletando histórico no Yahoo...", flush=True)
    feitos, ok = [], 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(coletar_uma, c, fx, btc, taxa): c for c in lista}
        for i, fut in enumerate(as_completed(futs), 1):
            c = futs[fut]
            try:
                d = fut.result()
            except Exception as e:  # rede/rate limit: grava só os dados do CoinGecko
                print(f"  {c['symbol'].upper()}: erro {e}", flush=True)
                continue
            feitos.append(d)
            ok += d["status"] == "ok"
            if i % 25 == 0 or i == len(lista):
                print(f"  {i}/{len(lista)} ({ok} com histórico)", flush=True)
    salvar(feitos)
    return ok
