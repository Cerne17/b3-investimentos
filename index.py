"""Ponto de entrada na Vercel: expõe o app FastAPI de backend/app/main.py."""
import os
import sys
from pathlib import Path

# numpy com um thread só: as matrizes daqui são pequenas, e os threads extras do BLAS gastam CPU esperando trabalho
# (a Vercel cobra CPU ativa, de todos os threads)
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402,F401
