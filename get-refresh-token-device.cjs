#!/usr/bin/env node
/**
 * Device code flow to obtain an OAuth2 refresh token for Microsoft Advertising API.
 * Uses microsoft.com/devicelogin which supports "Sign in with Google".
 *
 * Usage:
 *   1. Set env var: BING_ADS_CLIENT_ID
 *   2. Run: node get-refresh-token-device.cjs
 *   3. Go to the URL shown, enter the code, sign in with Google
 *   4. Token is printed and stored in Keychain automatically
 */

const CLIENT_ID = process.env.BING_ADS_CLIENT_ID;
const SCOPE = "https://ads.microsoft.com/msads.manage offline_access";
const DEVICE_CODE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

if (!CLIENT_ID) {
  console.error("Set BING_ADS_CLIENT_ID env var first");
  process.exit(1);
}

async function main() {
  // Step 1: Request device code
  const dcResp = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }).toString(),
  });

  if (!dcResp.ok) {
    console.error("Failed to get device code:", await dcResp.text());
    process.exit(1);
  }

  const dcData = await dcResp.json();
  console.log("\n" + dcData.message);
  console.log("\nOpening browser...");

  // Open browser to the verification URL
  try {
    require("child_process").execSync(`open "${dcData.verification_uri}"`);
  } catch {
    console.log("Open the URL above in your browser.");
  }

  // Step 2: Poll for token
  const interval = (dcData.interval || 5) * 1000;
  const expiresAt = Date.now() + dcData.expires_in * 1000;

  console.log("\nWaiting for you to sign in...\n");

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, interval));

    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: dcData.device_code,
      }).toString(),
    });

    const tokenData = await tokenResp.json();

    if (tokenData.error === "authorization_pending") {
      process.stdout.write(".");
      continue;
    }

    if (tokenData.error === "slow_down") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (tokenData.error) {
      console.error("\nError:", tokenData.error, tokenData.error_description);
      process.exit(1);
    }

    if (tokenData.refresh_token) {
      console.log("\n\n=== SUCCESS ===");
      console.log("Refresh Token:", tokenData.refresh_token);

      // Auto-store in Keychain
      try {
        require("child_process").execSync(
          `security delete-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN 2>/dev/null; security add-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w '${tokenData.refresh_token}'`
        );
        console.log("\nRefresh token saved to Keychain automatically.");
      } catch (e) {
        console.log("\nFailed to save to Keychain. Store manually with:");
        console.log(`security add-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w "${tokenData.refresh_token}"`);
      }
      process.exit(0);
    }
  }

  console.error("\nDevice code expired. Please try again.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
