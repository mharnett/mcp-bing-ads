#!/bin/bash
# Behavioral + ratchet test for run-mcp.sh's Keychain resolution.
#
# run-mcp.sh must source the shared drak_ops keychain_get.sh helper (resolved
# via keychain_shell_helper_path()) instead of shelling out to
# `security find-generic-password` inline. Runs hermetically: a fake
# `security`, a fake `node`, and a fake `python3` are placed first on PATH,
# so no real Keychain access, no server launch, and no dependency on a real
# drak_ops install (CI runners here have never needed Python and don't have
# it -- provisioning a real install would need a new deploy-key/secret per
# repo, out of scope for a test-only need). The fake `python3` recognizes
# the one `-c '...keychain_shell_helper_path...'` call run-mcp.sh makes and
# resolves it to tests/fixtures/keychain_get.sh, a hermetic double of the
# real shared helper. Mirrors drak-ops's own tests/test_keychain_get_sh.py
# fake-security-on-PATH technique.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/run-mcp.sh"
FIXTURE_HELPER="$ROOT/tests/fixtures/keychain_get.sh"
PASS=0
FAIL=0

# Files legitimately allowed to contain the raw literal, and why -- an
# allowance WITH a reason, not a blanket skip, so the set can only shrink.
# (macOS ships bash 3.2, no associative arrays -- plain list + grep instead.)
ALLOWED_LITERAL_FILES="tests/run-mcp-keychain.test.sh tests/fixtures/keychain_get.sh"
# Reasons:
#   tests/run-mcp-keychain.test.sh   -- this file: the fake `security` stub
#     and this comment necessarily mention the literal to describe/detect it.
#   tests/fixtures/keychain_get.sh   -- a hermetic double of the real shared
#     helper, which itself contains the literal as its own implementation
#     (exactly like the real drak_ops/keychain_get.sh does) -- this is the
#     one place the string is SUPPOSED to live, not an inline caller.

is_allowed() {
  local rel="$1" f
  for f in $ALLOWED_LITERAL_FILES; do
    [ "$f" = "$rel" ] && return 0
  done
  return 1
}

make_sandbox() {
  local dir
  dir="$(mktemp -d)"

  cat >"$dir/security" <<'STUB'
#!/bin/bash
acct=""; svc=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) acct="$2"; shift 2 ;;
    -s) svc="$2";  shift 2 ;;
    *)  shift ;;
  esac
done
while IFS= read -r row; do
  [ -z "$row" ] && continue
  racct="${row%%|*}"; rest="${row#*|}"; rsvc="${rest%%|*}"
  [ "$rsvc" = "$svc" ] || continue
  if [ -z "$acct" ] || [ "$racct" = "$acct" ]; then
    printf '%s' "${row##*|}"; exit 0
  fi
done <<< "$KEYCHAIN"
exit 44
STUB

  cat >"$dir/node" <<'STUB'
#!/bin/bash
echo "DEV_TOKEN=${BING_ADS_DEVELOPER_TOKEN:-}"
echo "CLIENT_ID=${BING_ADS_CLIENT_ID:-}"
echo "CLIENT_SECRET=${BING_ADS_CLIENT_SECRET:-}"
echo "REFRESH_TOKEN=${BING_ADS_REFRESH_TOKEN:-}"
exit 0
STUB

  # Fake `python3`: run-mcp.sh's only use of it is
  # `python3 -c 'from drak_ops.keychain import keychain_shell_helper_path ...'`
  # to resolve HELPER. Rather than requiring a real drak_ops install (not
  # available on these CI runners), print the path to the checked-in test
  # fixture that doubles it.
  cat >"$dir/python3" <<STUB
#!/bin/bash
echo "$FIXTURE_HELPER"
STUB

  chmod +x "$dir/security" "$dir/node" "$dir/python3"
  echo "$dir"
}

run_case() {
  local sandbox
  sandbox="$(make_sandbox)"
  OUT="$(KEYCHAIN="$1" PATH="$sandbox:$PATH" bash "$SCRIPT" 2>&1)"
  RC=$?
  rm -rf "$sandbox"
}

assert_contains() {
  if grep -qF -- "$2" <<<"$1"; then
    echo "  ok: contains '$2'"; PASS=$((PASS+1))
  else
    echo "  FAIL: expected '$2' in:"; sed 's/^/       /' <<<"$1"; FAIL=$((FAIL+1))
  fi
}

assert_rc() {
  if [ "$1" -eq "$2" ]; then
    echo "  ok: exit $2"; PASS=$((PASS+1))
  else
    echo "  FAIL: expected exit $2, got $1"; FAIL=$((FAIL+1))
  fi
}

FULL="bing-ads-mcp|BING_ADS_DEVELOPER_TOKEN|devtok
bing-ads-mcp|BING_ADS_CLIENT_ID|cid
bing-ads-mcp|BING_ADS_CLIENT_SECRET|csec
bing-ads-mcp|BING_ADS_REFRESH_TOKEN|rtok"

echo "case: all four creds present -> resolved and node launched"
run_case "$FULL"
assert_contains "$OUT" "DEV_TOKEN=devtok"
assert_contains "$OUT" "CLIENT_ID=cid"
assert_contains "$OUT" "CLIENT_SECRET=csec"
assert_contains "$OUT" "REFRESH_TOKEN=rtok"
assert_rc "$RC" 0

echo "case: refresh token missing -> fatal, exit 1"
run_case "bing-ads-mcp|BING_ADS_DEVELOPER_TOKEN|devtok
bing-ads-mcp|BING_ADS_CLIENT_ID|cid
bing-ads-mcp|BING_ADS_CLIENT_SECRET|csec"
assert_contains "$OUT" "BING_ADS_REFRESH_TOKEN is empty"
assert_rc "$RC" 1

echo "case: client_secret missing but not required -> still starts (matches original fail-fast loop, which never checks CLIENT_SECRET)"
run_case "bing-ads-mcp|BING_ADS_DEVELOPER_TOKEN|devtok
bing-ads-mcp|BING_ADS_CLIENT_ID|cid
bing-ads-mcp|BING_ADS_REFRESH_TOKEN|rtok"
assert_contains "$OUT" "CLIENT_SECRET="
assert_rc "$RC" 0

echo "check: run-mcp.sh sources the shared helper via keychain_shell_helper_path()"
if grep -q "keychain_shell_helper_path" "$SCRIPT" && grep -q '^source "\$HELPER"' "$SCRIPT"; then
  echo "  ok: sources shared helper"; PASS=$((PASS+1))
else
  echo "  FAIL: run-mcp.sh does not resolve+source keychain_get.sh via keychain_shell_helper_path()"
  FAIL=$((FAIL+1))
fi

echo "ratchet: no unexcused tracked .sh file still shells out to security find-generic-password"
UNEXPECTED=""
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  if grep -q "find-generic-password" "$ROOT/$rel" 2>/dev/null; then
    if ! is_allowed "$rel"; then
      UNEXPECTED="$UNEXPECTED $rel"
    fi
  fi
done <<< "$(git -C "$ROOT" ls-files '*.sh')"
if [ -z "$UNEXPECTED" ]; then
  echo "  ok: no unexcused inline find-generic-password in tracked .sh files"; PASS=$((PASS+1))
else
  echo "  FAIL: new inline find-generic-password call site(s):$UNEXPECTED"
  FAIL=$((FAIL+1))
fi

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
