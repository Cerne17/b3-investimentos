#!/usr/bin/env bash
# Build na Vercel: baixa a base publicada pela coleta (release "dados") e compila o dashboard.
# Sem release (ou download falho/incompleto), usa data/b3.db se existir; sem nenhuma base, o build falha
# (melhor manter o deploy anterior no ar do que publicar o app sem dados).
set -u
URL="https://github.com/Cerne17/b3-investimentos/releases/download/dados/b3.db"
if curl -fsSL -o data/b3.db.novo "$URL" && [ "$(wc -c < data/b3.db.novo)" -gt 1000000 ]; then
  mv data/b3.db.novo data/b3.db
  echo "base: release dados ($(wc -c < data/b3.db) bytes)"
else
  rm -f data/b3.db.novo
  if [ ! -s data/b3.db ]; then
    echo "base: release indisponível e sem data/b3.db local — abortando o build" >&2
    exit 1
  fi
  echo "base: release indisponível, usando data/b3.db local"
fi
set -e
cd frontend && npm ci && npx vite build
