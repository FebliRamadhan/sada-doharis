#!/usr/bin/env bash
#
# Test OAuth2 Authorization Code + PKCE flow end-to-end and print JSON at each step:
#   1. login            -> access token (Bearer)
#   2. /authorize       -> authorization code (from callback redirect)
#   3. /oauth/token     -> access_token + id_token + refresh_token
#   4. /userinfo        -> user claims (nip, fullname for internal employees)
#
# Requirements: curl, jq, openssl
#
# Usage:
#   BASE_URL=http://localhost:3001 \
#   CLIENT_ID=xxxx CLIENT_SECRET=yyyy \
#   REDIRECT_URI=http://localhost:3000/auth/callback \
#   EMAIL=febli.ramadhani@menpan.go.id PASSWORD=secret \
#   SCOPE="openid profile email pegawai" \
#   ./scripts/test-oauth-flow.sh
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
CLIENT_ID="${CLIENT_ID:?set CLIENT_ID}"
CLIENT_SECRET="${CLIENT_SECRET:?set CLIENT_SECRET}"
REDIRECT_URI="${REDIRECT_URI:-http://localhost:3000/auth/callback}"
EMAIL="${EMAIL:?set EMAIL}"
PASSWORD="${PASSWORD:?set PASSWORD}"
SCOPE="${SCOPE:-openid profile email pegawai}"
# Origin must be in the auth-service CORS_ORIGIN allow-list (needed for consent=approved)
ORIGIN="${ORIGIN:-http://localhost:3002}"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }

urlencode() { jq -rn --arg v "$1" '$v|@uri'; }

# ─── PKCE ───────────────────────────────────────────────────────────────────────
CODE_VERIFIER=$(openssl rand -base64 96 | tr -d '\n' | tr '+/' '-_' | tr -d '=' | cut -c1-64)
CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" \
  | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
STATE=$(openssl rand -hex 16)

# ─── 1. Login → access token (Bearer) ───────────────────────────────────────────
bold "1) POST ${BASE_URL}/auth/login"
LOGIN_JSON=$(curl -s -X POST "${BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${ORIGIN}" \
  -d "$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')")
echo "$LOGIN_JSON" | jq .
BEARER=$(echo "$LOGIN_JSON" | jq -r '.data.access_token')
[ "$BEARER" = "null" ] && { echo "Login failed"; exit 1; }

# ─── 2. Authorize → authorization code (captured from the callback redirect) ─────
bold "2) GET ${BASE_URL}/oauth/authorize  (consent=approved)"
AUTHZ_URL="${BASE_URL}/oauth/authorize?response_type=code"
AUTHZ_URL+="&client_id=$(urlencode "$CLIENT_ID")"
AUTHZ_URL+="&redirect_uri=$(urlencode "$REDIRECT_URI")"
AUTHZ_URL+="&scope=$(urlencode "$SCOPE")"
AUTHZ_URL+="&state=${STATE}"
AUTHZ_URL+="&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"
AUTHZ_URL+="&consent=approved"

# -i to read headers; the code arrives in the Location header of the 302 redirect
LOCATION=$(curl -s -i "$AUTHZ_URL" \
  -H "Authorization: Bearer ${BEARER}" \
  -H "Origin: ${ORIGIN}" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')
echo "Callback redirect: ${LOCATION:-<none>}"
CODE=$(printf '%s' "$LOCATION" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -z "$CODE" ] && { echo "No authorization code (check consent/scope/redirect_uri)"; exit 1; }
echo "code = $CODE"

# ─── 3. Token exchange → tokens ──────────────────────────────────────────────────
bold "3) POST ${BASE_URL}/oauth/token"
TOKEN_JSON=$(curl -s -X POST "${BASE_URL}/oauth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=${CODE}" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "code_verifier=${CODE_VERIFIER}")
echo "$TOKEN_JSON" | jq .
ACCESS=$(echo "$TOKEN_JSON" | jq -r '.access_token')

# Decoded id_token payload (JWT is base64url; not encrypted)
ID_TOKEN=$(echo "$TOKEN_JSON" | jq -r '.id_token // empty')
if [ -n "$ID_TOKEN" ]; then
  bold "3b) Decoded id_token payload"
  echo "$ID_TOKEN" | cut -d. -f2 | tr '_-' '/+' \
    | awk '{l=length%4; if(l>0)for(i=0;i<4-l;i++)$0=$0"="; print}' \
    | openssl base64 -d -A 2>/dev/null | jq .
fi

# ─── 4. UserInfo → claims ────────────────────────────────────────────────────────
bold "4) GET ${BASE_URL}/oauth/userinfo"
curl -s "${BASE_URL}/oauth/userinfo" -H "Authorization: Bearer ${ACCESS}" | jq .
