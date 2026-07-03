#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker build -f kaggle.Dockerfile -t sudoku-kaggle .
echo "built sudoku-kaggle"
