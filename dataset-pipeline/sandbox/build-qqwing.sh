#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker build -f qqwing.Dockerfile -t qqwing-trusted .
echo "built qqwing-trusted; verifying:"
docker run --rm --network none qqwing-trusted qqwing --version
