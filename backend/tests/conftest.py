"""Testes sem rede: os dados de mercado são séries sintéticas injetadas com monkeypatch."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def pregoes(inicio="2023-01-02", n=600):
    return pd.bdate_range(inicio, periods=n, tz="America/Sao_Paulo")


def historico(close, dividendos=None, splits=None, index=None):
    """DataFrame no formato do yfinance (Close, Dividends, Stock Splits)."""
    index = pregoes(n=len(close)) if index is None else index
    close = np.asarray(close, float)
    df = pd.DataFrame({"Open": close, "High": close, "Low": close, "Close": close, "Volume": 1000.0}, index=index)
    df["Dividends"] = 0.0 if dividendos is None else dividendos
    df["Stock Splits"] = 0.0 if splits is None else splits
    return df


@pytest.fixture
def mercado(monkeypatch):
    """Registra históricos sintéticos por ticker e faz history() devolvê-los em todos os módulos."""
    from app import desempenho, montecarlo, portfolio, yahoo
    dados = {}

    def history(ticker, period="2y", interval="1d"):
        if ticker not in dados:
            return pd.DataFrame()
        return dados[ticker].copy()

    for mod in (yahoo, desempenho, montecarlo, portfolio):
        monkeypatch.setattr(mod, "history", history, raising=False)
    monkeypatch.setattr(portfolio, "_CACHE", {})
    return dados
