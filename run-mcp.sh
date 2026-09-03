#!/bin/bash
# Wrapper to launch Bing Ads MCP with tokens from Keychain
#
# Shared Keychain helper (drak-ops): resolves through the installed package
# location, not a vendored copy — see drak_ops.keychain.keychain_shell_helper_path().
HELPER="$(python3 -c 'from drak_ops.keychain import keychain_shell_helper_path as p; print(p())')"
source "$HELPER"

export BING_ADS_DEVELOPER_TOKEN=$(keychain_get "BING_ADS_DEVELOPER_TOKEN" "bing-ads-mcp" 2>/dev/null)
export BING_ADS_CLIENT_ID=$(keychain_get "BING_ADS_CLIENT_ID" "bing-ads-mcp" 2>/dev/null)
# Azure app switched public -> confidential (2026-06: AADSTS70002 requires client_secret)
export BING_ADS_CLIENT_SECRET=$(keychain_get "BING_ADS_CLIENT_SECRET" "bing-ads-mcp" 2>/dev/null)
export BING_ADS_REFRESH_TOKEN=$(keychain_get "BING_ADS_REFRESH_TOKEN" "bing-ads-mcp" 2>/dev/null)

# Fail fast if Keychain lookup returned empty
for var in BING_ADS_DEVELOPER_TOKEN BING_ADS_CLIENT_ID BING_ADS_REFRESH_TOKEN; do
  if [ -z "${!var}" ]; then
    echo "[FATAL] $var is empty — Keychain lookup failed." >&2
    echo "  Fix: security add-generic-password -a bing-ads-mcp -s $var -w 'YOUR_VALUE'" >&2
    exit 1
  fi
done

exec node /Users/mark/claude-code/mcps/mcp-bing-ads/dist/index.js
