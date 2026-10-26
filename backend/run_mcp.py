"""Ponto de entrada do MCP que funciona de qualquer diretório: python /caminho/backend/run_mcp.py [--http]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.mcp_server import main  # noqa: E402

main()
