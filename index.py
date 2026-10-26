"""Ponto de entrada na Vercel: expõe o app FastAPI de backend/app/main.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402,F401
