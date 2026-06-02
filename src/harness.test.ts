import { registerMcpTests } from "@drak-marketing/mcp-test-harness";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerMcpTests({
  name: "mcp-bing-ads",
  repoRoot: path.resolve(__dirname, ".."),
  toolPrefix: "bing_ads_",
  minTools: 8,
  requiredTools: ["bing_ads_get_client_context", "bing_ads_list_campaigns", "bing_ads_keyword_performance"],
  binEntries: { "mcp-bing-ads": "dist/index.js" },
  hasAuthCli: false,
  hasCredentials: false,
  hasResilience: true,
  hasPlatform: false,
  requiredEnvVars: ["BING_ADS_DEVELOPER_TOKEN", "BING_ADS_CLIENT_ID", "BING_ADS_REFRESH_TOKEN"],
  envPrefix: "BING_ADS_",
  sourceLintIgnore: ["keychain.ts"], // keychain.ts uses execFileSync for Keychain access (macOS `security`); index.ts is now lint-clean (fileURLToPath, no exec)
});
