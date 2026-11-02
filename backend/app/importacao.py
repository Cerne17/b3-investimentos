"""Prepara uma carteira para o Home Broker do site: valida os dados e gera o JSON e o link de importação.

O link segue o formato de frontend/src/lib/compartilhar.js: [nome, meta_renda, [[data, ticker, c|v, quantidade, preco,
evento?], ...]] em JSON, comprimido (deflate) e em base64url depois do "#", então a carteira não passa pelo servidor.
"""
import base64
import json
import zlib
from datetime import date, datetime

from . import rendafixa, repository as repo, yahoo
from .importar_b3 import EVENTOS, _num

SITE = "https://b3.cerne.pro/"
LINK_MAX = 8000  # acima disso alguns aplicativos cortam o link: melhor usar o arquivo


def _sugestoes(ticker: str) -> list[str]:
    base = rendafixa._base(ticker)
    achados = rendafixa.buscar(base) + repo.buscar(base, 3)
    return [t for t in dict.fromkeys(a["ticker"] for a in achados) if t != base][:3]


def _problema_do_ticker(ticker: str, avisos: list[str]) -> str | None:
    """Confere se o site reconhece o ticker. Fora da base, aceita o que o Yahoo cota (com aviso)."""
    base = rendafixa._base(ticker)
    try:
        if rendafixa.eh_tesouro(base):
            rendafixa.cotacao(base)
            return None
        achados = repo.buscar(base, 10)
        if rendafixa.eh_renda_fixa(base) or any(a["ticker"] == base for a in achados):
            return None
        # código de um ativo da base com outro ticker (BTC é BTC-BRL): no Yahoo, BTC seria outro ativo, em dólar
        if not any(a.get("codigo") == base for a in achados):
            moeda = yahoo.cotacao(base).get("moeda") or "BRL"
            extra = f"; cotado em {moeda}, não em reais" if moeda != "BRL" else ""
            avisos.append(f"{ticker}: fora da base do site, mas com cotação no Yahoo{extra}; métricas e proventos podem faltar.")
            return None
    except LookupError:
        pass
    except Exception as e:
        avisos.append(f"{ticker}: não consegui confirmar o ticker agora ({e}).")
        return None
    sugestoes = _sugestoes(ticker)
    return f"{ticker}: ticker não encontrado." + (f" Quis dizer {' ou '.join(sugestoes)}?" if sugestoes else " Use buscar_ativos para achar o código.")


def _data(valor, rotulo: str, erros: list[str]) -> str | None:
    for formato in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            d = datetime.strptime(str(valor).strip(), formato).date()
        except ValueError:
            continue
        if d > date.today():
            erros.append(f"{rotulo}: data {d:%d/%m/%Y} está no futuro.")
            return None
        return d.isoformat()
    erros.append(f"{rotulo}: data inválida ({valor!r}); use AAAA-MM-DD.")
    return None


def _operacoes(transacoes: list[dict], erros: list[str], avisos: list[str]) -> list[dict]:
    ops = []
    for i, t in enumerate(transacoes, 1):
        rotulo = f"Operação {i} ({t.get('ticker') or 'sem ticker'})"
        evento = str(t["evento"]).lower() if t.get("evento") else None
        tipo = str(t.get("tipo") or "compra").strip().lower()
        quantidade, preco = _num(t.get("quantidade")), _num(t.get("preco"))
        data = _data(t.get("data"), rotulo, erros)
        if not t.get("ticker"):
            erros.append(f"{rotulo}: falta o ticker.")
        if tipo not in ("compra", "venda"):
            erros.append(f"{rotulo}: tipo deve ser compra ou venda, não {tipo!r}.")
        if evento and evento not in EVENTOS.values():
            erros.append(f"{rotulo}: evento deve ser {' ou '.join(sorted(set(EVENTOS.values())))}, não {evento!r}.")
        if not quantidade or quantidade <= 0:
            erros.append(f"{rotulo}: quantidade deve ser maior que zero.")
        if not evento and (not preco or preco <= 0):
            erros.append(f"{rotulo}: preço deve ser maior que zero.")
        if t.get("ticker") and data:
            ops.append({"data": data, "ticker": rendafixa.normalizar(t["ticker"]), "tipo": tipo, "quantidade": quantidade,
                        "preco": preco or 0, **({"evento": evento} if evento else {})})
    if erros:
        return ops
    ops.sort(key=lambda o: (o["data"], o["tipo"] == "venda"))  # no mesmo dia, a compra vem antes da venda
    saldo: dict[str, float] = {}
    for o in ops:
        saldo[o["ticker"]] = saldo.get(o["ticker"], 0) + (o["quantidade"] if o["tipo"] == "compra" else -o["quantidade"])
        if saldo[o["ticker"]] < -1e-9:
            avisos.append(f"{o['ticker']}: venda em {o['data']} maior que a posição até ali; "
                          "o site limita a venda ao que existe. Faltam compras anteriores?")
            saldo[o["ticker"]] = 0
    return ops


def _posicoes(posicoes: list[dict], erros: list[str], avisos: list[str]) -> list[dict]:
    out = []
    for i, p in enumerate(posicoes, 1):
        rotulo = f"Posição {i} ({p.get('ticker') or 'sem ticker'})"
        quantidade, preco = _num(p.get("quantidade")), _num(p.get("preco_medio"))
        if not p.get("ticker"):
            erros.append(f"{rotulo}: falta o ticker.")
            continue
        if not quantidade or quantidade <= 0:
            erros.append(f"{rotulo}: quantidade deve ser maior que zero.")
        if not preco or preco <= 0:
            avisos.append(f"{p['ticker']}: sem preço médio; lucro e rentabilidade desse ativo ficam incorretos.")
        out.append({"ticker": rendafixa.normalizar(p["ticker"]), "quantidade": quantidade, "preco_medio": preco or 0})
    if not erros:
        avisos.append("Só posições: entram como compras na data de hoje, sem histórico de desempenho e proventos.")
    return out


def _link(nome: str, ops: list[dict]) -> str:
    compactas = [[o["data"], o["ticker"], "v" if o["tipo"] == "venda" else "c", o["quantidade"], o["preco"],
                  *([o["evento"]] if o.get("evento") else [])] for o in ops]
    texto = json.dumps([nome, None, compactas], ensure_ascii=False, separators=(",", ":")).encode()
    deflate = zlib.compressobj(9, zlib.DEFLATED, -15)  # deflate "cru", como o CompressionStream('deflate-raw') do site
    return f"{SITE}#broker?c={base64.urlsafe_b64encode(deflate.compress(texto) + deflate.flush()).rstrip(b'=').decode()}"


def gerar(nome: str = "Carteira importada", transacoes: list[dict] | None = None, posicoes: list[dict] | None = None) -> dict:
    erros: list[str] = []
    avisos: list[str] = []
    if bool(transacoes) == bool(posicoes):
        return {"ok": False, "erros": ["Informe transacoes (com histórico) ou posicoes (só a posição atual), um dos dois."], "avisos": []}
    nome = str(nome or "").strip() or "Carteira importada"
    if transacoes:
        ops = _operacoes(transacoes, erros, avisos)
        tickers = [o["ticker"] for o in ops]
    else:
        pos = _posicoes(posicoes, erros, avisos)
        tickers = [p["ticker"] for p in pos]
    tickers = list(dict.fromkeys(tickers))
    erros += [e for e in (_problema_do_ticker(t, avisos) for t in tickers) if e]
    if erros:
        return {"ok": False, "erros": erros, "avisos": avisos}

    if transacoes:
        arquivo = {"nome": nome, "transacoes": ops}
    else:
        arquivo = {"nome": nome, "posicoes": pos}
        ops = [{"data": date.today().isoformat(), "ticker": p["ticker"], "tipo": "compra", "quantidade": p["quantidade"], "preco": p["preco_medio"]} for p in pos]
    link = _link(nome, ops)
    if len(link) > LINK_MAX:
        avisos.append("Link muito longo: alguns aplicativos podem cortá-lo. Se não abrir, use o arquivo JSON.")
    return {
        "ok": True, "nome": nome, "operacoes": len(ops), "ativos": tickers, "avisos": avisos, "link": link, "arquivo_json": arquivo,
        "como_importar": "Abra o link e clique em \"Importar neste navegador\". Ou salve arquivo_json como carteira.json e use "
                         "Home Broker > Importar. As duas formas criam uma carteira nova.",
    }
