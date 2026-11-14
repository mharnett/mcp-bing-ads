export interface ClientConfig {
  customer_id: string;
  account_id: string;
  name: string;
  folder: string;
}

export interface OAuthConfig {
  client_id: string;
  client_secret?: string;
  token_url: string;
  scope: string;
}

export interface Config {
  oauth: OAuthConfig;
  clients: Record<string, ClientConfig>;
}

// Same values as config.example.json. No offline_access: the shared refresh-token chain must not rotate.
export const DEFAULT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const DEFAULT_SCOPE = "https://ads.microsoft.com/msads.manage";

const envValue = (env: NodeJS.ProcessEnv, key: string): string =>
  (env[key] || "").trim().replace(/^["']|["']$/g, "");

interface ResolveOptions {
  configPath: string;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

/**
 * config.json wins when it exists. Otherwise the config is built from the documented env vars, so
 * `npx mcp-bing-ads` works with no file on disk. Account and customer ids are optional env vars;
 * without them the server starts with no client and tool calls say so.
 */
export function resolveConfig({ configPath, env, exists, read }: ResolveOptions): Config {
  if (exists(configPath)) {
    return JSON.parse(read(configPath));
  }

  const missing = ["BING_ADS_DEVELOPER_TOKEN", "BING_ADS_CLIENT_ID", "BING_ADS_REFRESH_TOKEN"].filter(
    (k) => !envValue(env, k),
  );
  if (missing.length > 0) {
    throw new Error(
      `Config file not found at ${configPath} and these env vars are not set: ${missing.join(", ")}. ` +
        `Either create config.json from config.example.json, or set BING_ADS_DEVELOPER_TOKEN, BING_ADS_CLIENT_ID, ` +
        `BING_ADS_REFRESH_TOKEN (and BING_ADS_CLIENT_SECRET for a confidential client). ` +
        `Run 'node get-refresh-token.cjs' to obtain a refresh token.`,
    );
  }

  const accountId = envValue(env, "BING_ADS_ACCOUNT_ID");
  const customerId = envValue(env, "BING_ADS_CUSTOMER_ID");
  if (Boolean(accountId) !== Boolean(customerId)) {
    throw new Error(
      `Set both BING_ADS_ACCOUNT_ID and BING_ADS_CUSTOMER_ID, or neither: ${accountId ? "BING_ADS_CUSTOMER_ID" : "BING_ADS_ACCOUNT_ID"} is missing.`,
    );
  }

  const clientSecret = envValue(env, "BING_ADS_CLIENT_SECRET");
  const config: Config = {
    oauth: {
      client_id: envValue(env, "BING_ADS_CLIENT_ID"),
      token_url: DEFAULT_TOKEN_URL,
      scope: DEFAULT_SCOPE,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    },
    clients: {},
  };
  if (accountId && customerId) {
    config.clients.default = {
      customer_id: customerId,
      account_id: accountId,
      name: envValue(env, "BING_ADS_ACCOUNT_NAME") || "default",
      folder: "",
    };
  }
  return config;
}
