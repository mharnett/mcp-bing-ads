import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseArgs, handleRefreshToken } = require("../get-refresh-token-device.cjs");

const TOKEN = "M.C559_BAY.0.U.fake!token*value$";

describe("get-refresh-token-device", () => {
  describe("parseArgs", () => {
    it("defaults to the MCP's Keychain service", () => {
      expect(parseArgs([])).toEqual({ keychainService: "BING_ADS_REFRESH_TOKEN" });
    });

    it("accepts --keychain-service <name>", () => {
      expect(parseArgs(["--keychain-service", "BING_ADS_REFRESH_TOKEN_VIEWER"])).toEqual({
        keychainService: "BING_ADS_REFRESH_TOKEN_VIEWER",
      });
    });

    it("rejects --keychain-service with no name", () => {
      expect(() => parseArgs(["--keychain-service"])).toThrow(/--keychain-service/);
      expect(() => parseArgs(["--keychain-service", "--other"])).toThrow(/--keychain-service/);
    });

    it("rejects unknown arguments", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/--bogus/);
    });
  });

  describe("handleRefreshToken", () => {
    it("stores the token under the chosen service", () => {
      const store = vi.fn(() => ({ where: "keychain" }));
      const ok = handleRefreshToken(TOKEN, "BING_ADS_REFRESH_TOKEN_VIEWER", { store, log: vi.fn() });

      expect(ok).toBe(true);
      expect(store).toHaveBeenCalledWith({
        account: "bing-ads-mcp",
        service: "BING_ADS_REFRESH_TOKEN_VIEWER",
        secret: TOKEN,
      });
    });

    it("never prints the token on success", () => {
      const log = vi.fn();
      handleRefreshToken(TOKEN, "BING_ADS_REFRESH_TOKEN", { store: () => ({ where: "keychain" }), log });

      const printed = log.mock.calls.flat().join("\n");
      expect(printed).not.toContain(TOKEN);
      expect(printed).toContain("BING_ADS_REFRESH_TOKEN");
    });

    it("reports failure, without the token, when it cannot be saved", () => {
      const log = vi.fn();
      const store = () => ({ where: null, error: "EACCES" });
      const ok = handleRefreshToken(TOKEN, "BING_ADS_REFRESH_TOKEN", { store, log });

      expect(ok).toBe(false);
      expect(log.mock.calls.flat().join("\n")).not.toContain(TOKEN);
    });
  });
});
