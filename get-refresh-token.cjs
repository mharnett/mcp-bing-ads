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
 *   5. The token is never printed. It is saved to the macOS Keychain, or, off
 *      macOS or if that fails, to a file only your user can read. The script
 *      says which, and how to load it.
 */

const http = require("http");
const { execSync } = require("child_process");
const { storeToken, describeStored, describeOAuthError, describeFailure, listenLoopback } = require("./token-store.cjs");

const KEYCHAIN_ACCOUNT = "bing-ads-mcp";
const TOKEN_NAME = "BING_ADS_REFRESH_TOKEN";

const CLIENT_ID = process.env.BING_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.BING_ADS_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPE = "https://ads.microsoft.com/msads.manage offline_access openid email profile";
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

const LOGIN_HINT = process.env.BING_ADS_LOGIN_HINT || "";
const authUrlFor = (clientId) => `${AUTH_URL}?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}&response_mode=query&prompt=select_account${LOGIN_HINT ? "&login_hint=" + encodeURIComponent(LOGIN_HINT) : ""}`;

function signedInAs(idToken) {
  try {
    if (idToken) {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString());
      return payload.preferred_username || payload.email || payload.upn || payload.name || "(no email claim)";
    }
  } catch {}
  return "(unknown)";
}

async function exchangeCode(code, clientId, deps) {
  // Public client flow unless a client secret is set
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  });
  if (CLIENT_SECRET) {
    params.set("client_secret", CLIENT_SECRET);
  }

  const resp = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await resp.json();

  if (!data.refresh_token) {
    const why = describeOAuthError(data);
    deps.log(`No refresh token in response (${why})`);
    return { ok: false, text: `Error: ${why}` };
  }

  const who = signedInAs(data.id_token);
  const result = deps.store({ account: KEYCHAIN_ACCOUNT, service: TOKEN_NAME, secret: data.refresh_token });
  deps.log(`\n>>> Signed in as: ${who} <<<  (check this is the account you meant to use)`);
  deps.log(describeStored(result, { account: KEYCHAIN_ACCOUNT, service: TOKEN_NAME, envVar: TOKEN_NAME }));
  return result.where
    ? { ok: true, text: `Signed in as ${who}. Token saved. You can close this tab.` }
    : { ok: false, text: "The token could not be saved. See the terminal." };
}

function startCallbackServer({ port, clientId, deps }) {
  const handler = async (req, res) => {
    if (!req.url.startsWith("/callback")) return;

    const url = new URL(req.url, "http://localhost:3000");
    const code = url.searchParams.get("code");

    if (!code) {
      res.writeHead(400);
      res.end("No code received");
      return;
    }

    let outcome;
    try {
      outcome = await exchangeCode(code, clientId, deps);
    } catch (err) {
      const why = describeFailure(err);
      deps.log(`Token exchange failed: ${why}`);
      outcome = { ok: false, text: `Error: ${why}` };
    }
    res.writeHead(outcome.ok ? 200 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(outcome.text, () => deps.done(outcome.ok ? 0 : 1));
  };
  return listenLoopback(() => http.createServer(handler), port);
}

async function main() {
  if (!CLIENT_ID) {
    console.error("Set BING_ADS_CLIENT_ID env var first");
    process.exit(1);
  }

  await startCallbackServer({
    port: 3000,
    clientId: CLIENT_ID,
    deps: {
      fetch,
      store: storeToken,
      log: console.log,
      done: (exitCode) => setTimeout(() => process.exit(exitCode), 1000),
    },
  });

  const authUrl = authUrlFor(CLIENT_ID);
  if (process.env.BING_ADS_AUTO_OPEN === "1") {
    try { execSync(`open "${authUrl}"`); } catch {}
  }
  console.log("\n>>> Do NOT let any other tab hit localhost:3000. <<<");
  console.log(">>> Copy this URL into an INCOGNITO window and sign in:\n");
  console.log(authUrl);
  console.log("");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Could not start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { startCallbackServer };
