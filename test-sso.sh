#!/bin/sh
# Usage: ./test-sso.sh <CLIENT_ID> <CLIENT_SECRET> [BASE_URL]
# Example: ./test-sso.sh abc123 secret456 http://localhost:3001

CLIENT_ID="${1}"
CLIENT_SECRET="${2}"
BASE_URL="${3:-http://localhost:3001}"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Usage: ./test-sso.sh <CLIENT_ID> <CLIENT_SECRET> [BASE_URL]"
  exit 1
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { printf "${GREEN}[PASS]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; }
info() { printf "${YELLOW}[INFO]${NC} %s\n" "$1"; }

echo ""
echo "======================================"
echo " SADA SSO — Quick Test"
echo " Server  : $BASE_URL"
echo " ClientID: $CLIENT_ID"
echo "======================================"

# 1. Health check
echo ""
info "1. Health check..."
HEALTH=$(curl -sf "$BASE_URL/health")
if [ $? -eq 0 ]; then
  pass "Server is up: $HEALTH"
else
  fail "Server tidak bisa diakses di $BASE_URL"
  exit 1
fi

# 2. OIDC Discovery
echo ""
info "2. OIDC Discovery document..."
DISCOVERY=$(curl -sf "$BASE_URL/oauth/.well-known/openid-configuration")
if [ $? -eq 0 ]; then
  pass "Discovery OK"
  echo "$DISCOVERY" | python3 -m json.tool 2>/dev/null || echo "$DISCOVERY"
else
  fail "Discovery endpoint gagal"
fi

# 3. Client Credentials Grant
echo ""
info "3. Client Credentials Grant..."
BODY="{\"grant_type\":\"client_credentials\",\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\",\"scope\":\"openid\"}"
TOKEN_RESPONSE=$(curl -sf -X POST "$BASE_URL/oauth/token" -H "Content-Type: application/json" -d "$BODY")

if [ $? -ne 0 ]; then
  fail "Token request gagal — cek client_id dan client_secret"
  curl -s -X POST "$BASE_URL/oauth/token" -H "Content-Type: application/json" -d "$BODY"
  echo ""
  exit 1
fi

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
EXPIRES_IN=$(echo "$TOKEN_RESPONSE"   | python3 -c "import sys,json; print(json.load(sys.stdin).get('expires_in','?'))" 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ]; then
  fail "Tidak ada access_token dalam response:"
  echo "$TOKEN_RESPONSE"
  exit 1
fi

pass "Access Token didapat (expires_in: ${EXPIRES_IN}s)"
SHORT_TOKEN=$(echo "$ACCESS_TOKEN" | cut -c1-40)
echo "  Token: ${SHORT_TOKEN}..."

# 4. Token Introspection
echo ""
info "4. Token Introspection..."
IBODY="{\"token\":\"$ACCESS_TOKEN\",\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\"}"
INTRO=$(curl -sf -X POST "$BASE_URL/oauth/introspect" -H "Content-Type: application/json" -d "$IBODY")

if [ $? -eq 0 ]; then
  ACTIVE=$(echo "$INTRO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active','?'))" 2>/dev/null)
  if [ "$ACTIVE" = "True" ] || [ "$ACTIVE" = "true" ]; then
    pass "Token aktif"
    echo "$INTRO" | python3 -m json.tool 2>/dev/null || echo "$INTRO"
  else
    fail "Token tidak aktif: $INTRO"
  fi
else
  fail "Introspect endpoint gagal"
  curl -v -X POST "$BASE_URL/oauth/introspect" -H "Content-Type: application/json" -d "$IBODY" 2>&1 | tail -20
fi

# 5. JWKS endpoint
echo ""
info "5. JWKS public key..."
JWKS=$(curl -sf "$BASE_URL/.well-known/jwks.json")
if [ $? -eq 0 ]; then
  KID=$(echo "$JWKS" | python3 -c "import sys,json; keys=json.load(sys.stdin).get('keys',[]); print(keys[0].get('kid','?') if keys else 'no keys')" 2>/dev/null)
  pass "JWKS OK — kid: $KID"
else
  fail "JWKS endpoint gagal"
fi

# 6. Token Revocation
echo ""
info "6. Token Revocation..."
RBODY="{\"token\":\"$ACCESS_TOKEN\"}"
curl -sf -X POST "$BASE_URL/oauth/revoke" -H "Content-Type: application/json" -d "$RBODY" > /dev/null
if [ $? -eq 0 ]; then
  pass "Token berhasil direvoke"
else
  fail "Revoke gagal"
fi

# 7. Introspect setelah revoke
echo ""
info "7. Verifikasi token tidak aktif setelah revoke..."
INTRO2=$(curl -sf -X POST "$BASE_URL/oauth/introspect" -H "Content-Type: application/json" -d "$IBODY")
ACTIVE2=$(echo "$INTRO2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active','?'))" 2>/dev/null)
if [ "$ACTIVE2" = "False" ] || [ "$ACTIVE2" = "false" ]; then
  pass "Token inactive setelah revoke — revocation berfungsi"
else
  fail "Token masih aktif setelah revoke: $INTRO2"
fi

# Summary
echo ""
echo "======================================"
echo " Test selesai."
echo ""
echo " Untuk test Authorization Code (browser):"
echo " buka URL berikut di browser:"
echo ""
printf " http://localhost:3002/authorize?response_type=code&client_id=%s&redirect_uri=http://localhost:9999/cb&scope=openid%%20profile%%20email&state=test\n" "$CLIENT_ID"
echo "======================================"
