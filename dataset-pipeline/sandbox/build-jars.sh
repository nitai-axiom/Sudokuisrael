#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./jars.lock
docker build -f jars.Dockerfile \
  --build-arg HODOKU_URL="$HODOKU_URL" --build-arg HODOKU_SHA256="$HODOKU_SHA256" \
  --build-arg SERATE_REPO="$SERATE_REPO" --build-arg SERATE_COMMIT="$SERATE_COMMIT" \
  -t sudoku-jars .
echo "built sudoku-jars; contents:"
docker run --rm --network none sudoku-jars ls -la /opt
