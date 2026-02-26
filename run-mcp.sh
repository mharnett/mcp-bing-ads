#!/bin/bash
# Wrapper to launch Bing Ads MCP with tokens from Keychain
export BING_ADS_DEVELOPER_TOKEN=$(security find-generic-password -a bing-ads-mcp -s BING_ADS_DEVELOPER_TOKEN -w 2>/dev/null)
export BING_ADS_CLIENT_ID=$(security find-generic-password -a bing-ads-mcp -s BING_ADS_CLIENT_ID -w 2>/dev/null)
# client_secret not needed for public client apps (Azure AD rejects it)
# export BING_ADS_CLIENT_SECRET=$(security find-generic-password -a bing-ads-mcp -s BING_ADS_CLIENT_SECRET -w 2>/dev/null)
export BING_ADS_REFRESH_TOKEN=$(security find-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w 2>/dev/null)
exec node /Users/mark/claude-code/mcps/mcp-bing-ads/dist/index.js
