#!/usr/bin/env bash
# 공개 HTTP 엔드포인트 스모크. 사용: ./scripts/smoke_gateway.sh [BASE_URL]
# 예: ./scripts/smoke_gateway.sh http://127.0.0.1:8000
set -euo pipefail
BASE="${1:-http://127.0.0.1:8000}"
BASE="${BASE%/}"
echo "GET $BASE/health"
curl -sS -f "$BASE/health" | head -c 200
echo ""
echo "GET $BASE/v1/product-vision (앞부분만)"
curl -sS -f "$BASE/v1/product-vision" | head -c 400
echo ""
echo "smoke_gateway OK"
