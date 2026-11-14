import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULT_TOKEN_URL, DEFAULT_SCOPE } from "./config.js";

const PATH = "/pkg/config.json";
const noFile = { exists: () => false, read: () => { throw new Error("should not read"); } };
const ENV_OK = {
  BING_ADS_DEVELOPER_TOKEN: "dev-token-placeholder",
  BING_ADS_CLIENT_ID: "client-id-placeholder",
  BING_ADS_CLIENT_SECRET: "client-secret-placeholder",
  BING_ADS_REFRESH_TOKEN: "refresh-token-placeholder",
};

describe("resolveConfig", () => {
  it("builds a valid config from the documented env vars when config.json is absent", () => {
    const cfg = resolveConfig({ configPath: PATH, env: ENV_OK, ...noFile });
    expect(cfg.oauth.client_id).toBe("client-id-placeholder");
    expect(cfg.oauth.client_secret).toBe("client-secret-placeholder");
    expect(cfg.oauth.token_url).toBe(DEFAULT_TOKEN_URL);
    expect(cfg.oauth.scope).toBe(DEFAULT_SCOPE);
    expect(cfg.oauth.scope).not.toContain("offline_access");
    expect(cfg.clients).toEqual({});
  });

  it("adds a default client when account and customer ids are in env", () => {
    const cfg = resolveConfig({
      configPath: PATH,
      env: { ...ENV_OK, BING_ADS_ACCOUNT_ID: "111", BING_ADS_CUSTOMER_ID: "222" },
      ...noFile,
    });
    expect(cfg.clients.default).toMatchObject({ account_id: "111", customer_id: "222" });
  });

  it("strips quotes and whitespace from env values, like the rest of the server", () => {
    const cfg = resolveConfig({
      configPath: PATH,
      env: { ...ENV_OK, BING_ADS_CLIENT_ID: '  "quoted-id"  ' },
      ...noFile,
    });
    expect(cfg.oauth.client_id).toBe("quoted-id");
  });

  it("omits client_secret for a public client", () => {
    const { BING_ADS_CLIENT_SECRET: _drop, ...env } = ENV_OK;
    const cfg = resolveConfig({ configPath: PATH, env, ...noFile });
    expect(cfg.oauth.client_secret).toBeUndefined();
  });

  it("config.json wins when present, env is not merged in", () => {
    const file = { oauth: { client_id: "from-file", token_url: "u", scope: "s" }, clients: { a: { customer_id: "1", account_id: "2", name: "A", folder: "/a" } } };
    const cfg = resolveConfig({
      configPath: PATH,
      env: ENV_OK,
      exists: () => true,
      read: () => JSON.stringify(file),
    });
    expect(cfg).toEqual(file);
  });

  it("a partial env names every missing variable", () => {
    expect(() => resolveConfig({ configPath: PATH, env: { BING_ADS_CLIENT_ID: "x" }, ...noFile })).toThrow(
      /BING_ADS_DEVELOPER_TOKEN.*BING_ADS_REFRESH_TOKEN/,
    );
    expect(() => resolveConfig({ configPath: PATH, env: {}, ...noFile })).toThrow(/BING_ADS_CLIENT_ID/);
  });

  it("only one of the two id vars set is an error naming the other", () => {
    expect(() =>
      resolveConfig({ configPath: PATH, env: { ...ENV_OK, BING_ADS_ACCOUNT_ID: "111" }, ...noFile }),
    ).toThrow(/BING_ADS_CUSTOMER_ID/);
  });
});
