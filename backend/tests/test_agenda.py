import pandas as pd

from app import agenda


def _divs(datas, valores):
    return pd.Series(valores, index=pd.DatetimeIndex(datas))


def test_mensal_repete_todo_mes_com_a_media_dos_ultimos_3():
    hoje = pd.Timestamp("2026-10-29")
    datas = pd.date_range("2025-11-01", periods=12, freq="MS") + pd.Timedelta(days=2)
    padrao, futuras = agenda._projetar(_divs(datas, [0.10] * 9 + [0.09, 0.10, 0.11]), hoje)
    assert padrao == "mensal" and len(futuras) == 12
    assert all(abs(v - 0.10) < 1e-9 for _, v in futuras)


def test_semestral_e_irregular():
    hoje = pd.Timestamp("2026-10-29")
    padrao, futuras = agenda._projetar(_divs(["2026-02-13", "2026-08-07"], [2.6, 1.98]), hoje)
    assert padrao == "semestral" and [d.strftime("%Y-%m") for d, _ in futuras] == ["2027-02", "2027-08"]
    padrao, futuras = agenda._projetar(_divs(["2025-12-22", "2026-04-23", "2026-06-02"], [1.0, 0.7, 0.7]), hoje)
    assert padrao.startswith("irregular") and [d.strftime("%Y-%m") for d, _ in futuras] == ["2026-12", "2027-04", "2027-06"]


def test_agenda_multiplica_pela_quantidade(monkeypatch):
    monkeypatch.setattr(agenda, "_datas_ex", lambda t: _divs(pd.date_range(end=pd.Timestamp.today().normalize(), periods=12, freq="30D"), [0.1] * 12))
    r = agenda.agenda([{"ticker": "MXRF11", "quantidade": 100}, {"ticker": "BTC-BRL", "quantidade": 1}])
    assert [a["ticker"] for a in r["ativos"]] == ["MXRF11"] and len(r["meses"]) == 12
    assert r["total_12m"] > 0 and all(i["valor"] == 10.0 for m in r["meses"] for i in m["itens"])
