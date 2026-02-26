#!/usr/bin/env node
/**
 * Helper to obtain an OAuth2 refresh token for Microsoft Advertising API.
 *
 * Usage:
 *   1. Register an app at https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps
 *      - Platform: Web
 *      - Redirect URI: http://localhost:3000/callback
 *      - API permissions: https://ads.microsoft.com/msads.manage
 *   2. Set env vars: BING_ADS_CLIENT_ID, BING_ADS_CLIENT_SECRET
 *   3. Run: node get-refresh-token.cjs
 *   4. Follow the browser prompt, sign in with your Microsoft account
 *   5. Copy the refresh token to Keychain:
 *      security add-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w "<token>"
 */

const http = require("http");
const { execSync } = require("child_process");

const CLIENT_ID = process.env.BING_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.BING_ADS_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPE = "https://ads.microsoft.com/msads.manage offline_access";
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

if (!CLIENT_ID) {
  console.error("Set BING_ADS_CLIENT_ID env var first");
  process.exit(1);
}

const LOGIN_HINT = process.env.BING_ADS_LOGIN_HINT || "";
const authUrl = `${AUTH_URL}?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}&response_mode=query&prompt=select_account${LOGIN_HINT ? "&login_hint=" + encodeURIComponent(LOGIN_HINT) : ""}`;

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) return;

  const url = new URL(req.url, "http://localhost:3000");
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400);
    res.end("No code received");
    return;
  }

  // Exchange code for tokens (public client flow — no client_secret)
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  });
  if (CLIENT_SECRET) {
    params.set("client_secret", CLIENT_SECRET);
  }

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await resp.json();

    if (data.refresh_token) {
      console.log("\n=== SUCCESS ===");
      console.log("Refresh Token:", data.refresh_token);
      console.log("\nStore in Keychain with:");
      console.log(`security add-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w "${data.refresh_token}"`);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Success!</h1><p>Refresh token printed in terminal. You can close this tab.</p>");
    } else {
      console.error("No refresh token in response:", data);
      res.writeHead(500);
      res.end("Error: " + JSON.stringify(data));
    }
  } catch (err) {
    console.error("Token exchange failed:", err);
    res.writeHead(500);
    res.end("Error: " + err.message);
  }

  setTimeout(() => process.exit(0), 1000);
});

server.listen(3000, () => {
  console.log("Opening browser for Microsoft sign-in...");
  console.log("Auth URL:", authUrl);
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log("Open the URL above in your browser.");
  }
});
