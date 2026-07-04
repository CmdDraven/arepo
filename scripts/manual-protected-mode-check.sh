#!/usr/bin/env bash
set -euo pipefail

AREPO_BASE_URL="${AREPO_BASE_URL:-http://127.0.0.1:8734}"
AREPO_BASE_URL="${AREPO_BASE_URL%/}"
AREPO_TOKEN="${AREPO_TOKEN:-}"
DEBUG_TOKENS="${DEBUG_TOKENS:-0}"
AREPO_AUDIT_EVENTS="${AREPO_AUDIT_EVENTS:-}"

LAST_STATUS=""
LAST_BODY=""

fail() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS %s\n' "$*"
}

info() {
  printf 'INFO %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_local_base_url() {
  case "$AREPO_BASE_URL" in
    http://127.0.0.1:*|http://localhost:*|http://[::1]:*)
      ;;
    *)
      fail "AREPO_BASE_URL must point at localhost for this manual fixture; got $AREPO_BASE_URL"
      ;;
  esac
}

token_label() {
  local token="$1"
  if [[ "$DEBUG_TOKENS" == "1" ]]; then
    printf '%s' "$token"
  else
    printf '<captured:%s chars>' "${#token}"
  fi
}

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"
  local confirmation="${5:-}"
  local response
  local -a args=(
    -sS
    -X "$method"
    -H "accept: application/json"
    -w $'\n%{http_code}'
  )

  if [[ -n "$body" ]]; then
    args+=(-H "content-type: application/json" --data "$body")
  fi
  if [[ -n "$token" ]]; then
    args+=(-H "authorization: Bearer $token")
  fi
  if [[ -n "$confirmation" ]]; then
    args+=(-H "x-arepo-confirmation: $confirmation")
  fi
  args+=("$AREPO_BASE_URL$path")

  response="$(curl "${args[@]}")"
  LAST_STATUS="${response##*$'\n'}"
  LAST_BODY="${response%$'\n'*}"
  jq -e . >/dev/null <<<"$LAST_BODY" || fail "$method $path did not return JSON"
}

expect_status() {
  local expected="$1"
  local label="$2"
  [[ "$LAST_STATUS" == "$expected" ]] || fail "$label expected HTTP $expected, got $LAST_STATUS"
}

expect_status_one_of() {
  local label="$1"
  shift
  local expected
  for expected in "$@"; do
    [[ "$LAST_STATUS" == "$expected" ]] && return 0
  done
  fail "$label expected HTTP status in [$*], got $LAST_STATUS"
}

expect_jq() {
  local filter="$1"
  local label="$2"
  jq -e "$filter" >/dev/null <<<"$LAST_BODY" || fail "$label"
}

json_value() {
  local filter="$1"
  jq -er "$filter" <<<"$LAST_BODY"
}

assert_no_internal_material() {
  local label="$1"
  local body="$2"
  case "$body" in
    *verifierHash*|*tokenHash*|*hashParameters*|*saltId*|*"\"salt\""*|*tokenVerifier*|*Authorization:*|*authorization:\ Bearer*|*Cookie:*|*cookie:*)
      fail "$label exposed verifier, hash, salt, authorization, or cookie material"
      ;;
  esac
}

assert_body_excludes_tokens() {
  local label="$1"
  local body="$2"
  shift 2
  local token
  for token in "$@"; do
    if [[ -n "$token" && "$body" == *"$token"* ]]; then
      fail "$label exposed raw token material"
    fi
  done
}

assert_no_bearer_token_field() {
  local label="$1"
  if jq -e 'any(.. | objects; has("bearerToken"))' >/dev/null <<<"$LAST_BODY"; then
    fail "$label included bearerToken outside one-time issuance response"
  fi
}

check_denied_response() {
  local label="$1"
  local expected_status="$2"
  shift 2
  expect_status "$expected_status" "$label"
  expect_jq '.ok == false' "$label did not return sanitized failure body"
  assert_no_internal_material "$label" "$LAST_BODY"
  assert_body_excludes_tokens "$label" "$LAST_BODY" "$@"
}

scan_audit_file_if_requested() {
  local path="$AREPO_AUDIT_EVENTS"
  if [[ -z "$path" ]]; then
    info "audit sanitization file scan skipped; set AREPO_AUDIT_EVENTS=/path/to/events.jsonl to enable it"
    return 0
  fi
  [[ -r "$path" ]] || fail "AREPO_AUDIT_EVENTS is not readable: $path"

  local line
  local token
  while IFS= read -r line; do
    case "$line" in
      *verifierHash*|*tokenHash*|*hashParameters*|*saltId*|*"\"salt\""*|*Authorization:*|*authorization:\ Bearer*|*Cookie:*|*cookie:*|*x-arepo-confirmation*)
        fail "audit file exposed secret or header material"
        ;;
    esac
    for token in "$@"; do
      if [[ -n "$token" && "$line" == *"$token"* ]]; then
        fail "audit file exposed raw token material"
      fi
    done
  done < "$path"
  pass "audit sanitization scan"
}

require_command curl
require_command jq
require_local_base_url

request_json GET "/api/node/status"
expect_status_one_of "anonymous reduced status" 200 503
expect_jq '.responseKind == "reduced-anonymous-status" and .authRequired == true' \
  "anonymous status was not reduced; is auth.mode protected?"
if jq -e 'has("credentialLifecycle") or has("vaults") or has("runtime") or has("node")' \
  >/dev/null <<<"$LAST_BODY"; then
  fail "anonymous reduced status exposed full diagnostics"
fi
assert_no_internal_material "anonymous reduced status" "$LAST_BODY"
assert_no_bearer_token_field "anonymous reduced status"
pass "anonymous reduced status"

if [[ -n "$AREPO_TOKEN" ]]; then
  pass "using supplied AREPO_TOKEN $(token_label "$AREPO_TOKEN"); bootstrap skipped"
else
  request_json POST "/api/node/credentials/bootstrap" '{"label":"manual acceptance bootstrap"}'
  if [[ "$LAST_STATUS" == "409" ]] && jq -e '.code == "active-credential-exists"' >/dev/null <<<"$LAST_BODY"; then
    printf 'FAIL bootstrap denied because active credentials already exist; rerun with AREPO_TOKEN="paste-one-time-token-here"\n' >&2
    exit 2
  fi
  expect_status 201 "bootstrap"
  AREPO_TOKEN="$(json_value '.data.bearerToken')"
  [[ "$AREPO_TOKEN" == arepo_* ]] || fail "bootstrap token did not use expected bearer token prefix"
  expect_jq '.data.tokenType == "Bearer" and (.data.credential.credentialId | type == "string")' \
    "bootstrap response shape changed"
  assert_no_internal_material "bootstrap response" "$LAST_BODY"
  pass "bootstrap captured one-time token $(token_label "$AREPO_TOKEN")"
fi

request_json GET "/api/node/status" "" "$AREPO_TOKEN"
expect_status 200 "authorized full status"
expect_jq '.auth.mode == "protected" and .credentialLifecycle.storeAvailable == true' \
  "authorized full status did not include safe credential lifecycle posture"
assert_no_internal_material "authorized full status" "$LAST_BODY"
assert_body_excludes_tokens "authorized full status" "$LAST_BODY" "$AREPO_TOKEN"
assert_no_bearer_token_field "authorized full status"
pass "authorized full status"

request_json GET "/api/node/credentials"
check_denied_response "missing token denied" 401 "$AREPO_TOKEN"
assert_no_bearer_token_field "missing token denied"
pass "missing token denied"

request_json GET "/api/node/credentials" "" "malformed-token"
check_denied_response "malformed token denied" 401 "$AREPO_TOKEN"
assert_body_excludes_tokens "malformed token denied" "$LAST_BODY" "malformed-token"
assert_no_bearer_token_field "malformed token denied"
pass "malformed token denied"

request_json GET "/api/node/credentials" "" "$AREPO_TOKEN"
expect_status 200 "credential listing"
expect_jq '.data.credentials | type == "array"' "credential listing response shape changed"
assert_no_internal_material "credential listing" "$LAST_BODY"
assert_body_excludes_tokens "credential listing" "$LAST_BODY" "$AREPO_TOKEN"
assert_no_bearer_token_field "credential listing"
pass "credential listing sanitized"

request_json POST "/api/node/credentials" \
  '{"label":"manual acceptance created credential","nodePermissions":["manageNode"],"vaultGrants":[]}' \
  "$AREPO_TOKEN" "confirm"
expect_status 201 "credential create"
CREATED_TOKEN="$(json_value '.data.bearerToken')"
CREATED_ID="$(json_value '.data.credential.credentialId')"
[[ "$CREATED_TOKEN" == arepo_* ]] || fail "created token did not use expected bearer token prefix"
expect_jq '.data.tokenType == "Bearer"' "credential create response shape changed"
assert_no_internal_material "credential create" "$LAST_BODY"
pass "credential create returned one-time token $(token_label "$CREATED_TOKEN") for $CREATED_ID"

request_json GET "/api/node/credentials" "" "$AREPO_TOKEN"
expect_status 200 "credential listing after create"
assert_no_internal_material "credential listing after create" "$LAST_BODY"
assert_body_excludes_tokens "credential listing after create" "$LAST_BODY" "$AREPO_TOKEN" "$CREATED_TOKEN"
assert_no_bearer_token_field "credential listing after create"
pass "created credential absent from metadata secrets"

request_json POST "/api/node/credentials" \
  '{"label":"manual acceptance wrong confirmation","nodePermissions":["manageNode"],"vaultGrants":[]}' \
  "$AREPO_TOKEN" "wrong"
check_denied_response "wrong confirmation denied" 428 "$AREPO_TOKEN" "$CREATED_TOKEN"
assert_body_excludes_tokens "wrong confirmation denied" "$LAST_BODY" "wrong"
assert_no_bearer_token_field "wrong confirmation denied"
pass "wrong confirmation denied"

request_json POST "/api/node/credentials/$CREATED_ID/rotate" \
  '{"label":"manual acceptance rotated credential"}' \
  "$AREPO_TOKEN" "confirm"
expect_status 201 "credential rotation"
ROTATED_TOKEN="$(json_value '.data.bearerToken')"
ROTATED_ID="$(json_value '.data.credential.credentialId')"
expect_jq '.data.oldCredential.status == "revoked" and .data.tokenType == "Bearer"' \
  "credential rotation response shape changed"
assert_no_internal_material "credential rotation" "$LAST_BODY"
pass "credential rotation returned one-time token $(token_label "$ROTATED_TOKEN") for $ROTATED_ID"

request_json GET "/api/node/status" "" "$CREATED_TOKEN"
check_denied_response "rotation revoked old token" 401 "$AREPO_TOKEN" "$CREATED_TOKEN" "$ROTATED_TOKEN"
assert_no_bearer_token_field "rotation revoked old token"
pass "rotation revoked old token"

request_json GET "/api/node/status" "" "$ROTATED_TOKEN"
expect_status 200 "rotated token authorized status"
assert_no_internal_material "rotated token authorized status" "$LAST_BODY"
assert_body_excludes_tokens "rotated token authorized status" "$LAST_BODY" "$AREPO_TOKEN" "$CREATED_TOKEN" "$ROTATED_TOKEN"
assert_no_bearer_token_field "rotated token authorized status"
pass "rotated token authorized status"

request_json POST "/api/node/credentials/$ROTATED_ID/revoke" \
  '{"reason":"manual acceptance cleanup"}' \
  "$AREPO_TOKEN" "confirm"
expect_status 200 "credential revocation"
expect_jq '.data.credential.status == "revoked"' "credential revocation response shape changed"
assert_no_internal_material "credential revocation" "$LAST_BODY"
assert_body_excludes_tokens "credential revocation" "$LAST_BODY" "$AREPO_TOKEN" "$CREATED_TOKEN" "$ROTATED_TOKEN"
assert_no_bearer_token_field "credential revocation"
pass "credential revocation"

request_json GET "/api/node/status" "" "$ROTATED_TOKEN"
check_denied_response "revocation denied revoked token" 401 "$AREPO_TOKEN" "$CREATED_TOKEN" "$ROTATED_TOKEN"
assert_no_bearer_token_field "revocation denied revoked token"
pass "revocation denied revoked token"

request_json GET "/api/node/credentials" "" "$AREPO_TOKEN"
expect_status 200 "credential listing after revocation"
jq -e --arg id "$ROTATED_ID" \
  '.data.credentials[] | select(.credentialId == $id) | .status == "revoked"' \
  >/dev/null <<<"$LAST_BODY" || fail "credential listing did not show revoked metadata"
assert_no_internal_material "credential listing after revocation" "$LAST_BODY"
assert_body_excludes_tokens "credential listing after revocation" "$LAST_BODY" "$AREPO_TOKEN" "$CREATED_TOKEN" "$ROTATED_TOKEN"
assert_no_bearer_token_field "credential listing after revocation"
pass "credential listing shows safe revoked metadata"

scan_audit_file_if_requested "$AREPO_TOKEN" "$CREATED_TOKEN" "$ROTATED_TOKEN"
pass "no obvious secret material found in checked responses"
