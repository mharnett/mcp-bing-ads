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
    it("upserts the token under the chosen service", () => {
      const exec = vi.fn();
      const ok = handleRefreshToken(TOKEN, "BING_ADS_REFRESH_TOKEN_VIEWER", { exec, log: vi.fn() });

      expect(ok).toBe(true);
      expect(exec).toHaveBeenCalledWith("security", [
        "add-generic-password",
        "-a",
        "bing-ads-mcp",
        "-s",
        "BING_ADS_REFRESH_TOKEN_VIEWER",
        "-w",
        TOKEN,
        "-U",
      ]);
    });

    it("never prints the token on success", () => {
      const log = vi.fn();
      handleRefreshToken(TOKEN, "BING_ADS_REFRESH_TOKEN", { exec: vi.fn(), log });

      const printed = log.mock.calls.flat().join("\n");
      expect(printed).not.toContain(TOKEN);
      expect(printed).toContain("BING_ADS_REFRESH_TOKEN");
    });

    it("never prints the token when the Keychain write fails", () => {
      const log = vi.fn();
      // execFileSync's error message echoes the full command line, token included.
      const exec = vi.fn(() => {
        throw new Error(`Command failed: security add-generic-password -w ${TOKEN} -U`);
      });
      const ok = handleRefreshToken(TOKEN, "BING_ADS_REFRESH_TOKEN", { exec, log });

      expect(ok).toBe(false);
      expect(log.mock.calls.flat().join("\n")).not.toContain(TOKEN);
    });
  });
});
