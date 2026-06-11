import { describe, it, expect, vi } from "vitest";
import {
  buildKeychainUpsertArgs,
  persistSecretToKeychain,
  KEYCHAIN_ACCOUNT,
} from "./keychain";

describe("keychain token persistence", () => {
  describe("buildKeychainUpsertArgs", () => {
    it("builds security command with atomic -U flag", () => {
      const args = buildKeychainUpsertArgs("test-service", "test-secret");

      // Verify atomic upsert flag is present (prevents lost tokens on delete failure)
      expect(args).toContain("-U");
      expect(args).toEqual([
        "add-generic-password",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        "test-service",
        "-w",
        "test-secret",
        "-U",
      ]);
    });

    it("allows custom account override", () => {
      const args = buildKeychainUpsertArgs("service", "secret", "custom-account");
      expect(args).toContain("-a");
      expect(args).toContain("custom-account");
    });
  });

  describe("persistSecretToKeychain", () => {
    it("returns true on successful upsert", () => {
      const mockExec = vi.fn(); // Does not throw
      const result = persistSecretToKeychain("test-service", "test-token", mockExec);

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        "security",
        expect.arrayContaining(["-U"]),
      );
    });

    it("returns false when keychain access denied (no throw)", () => {
      const mockExec = vi.fn(() => {
        throw new Error("Keychain locked");
      });
      const result = persistSecretToKeychain(
        "test-service",
        "test-token",
        mockExec,
      );

      // Critical: must return false, not throw (caller falls back to session token)
      expect(result).toBe(false);
    });

    it("uses atomic -U flag (anchor test: prevents delete-then-add race)", () => {
      const mockExec = vi.fn();
      persistSecretToKeychain("service", "new-token", mockExec);

      const callArgs = mockExec.mock.calls[0];
      const keychainArgs = callArgs[1] as string[];

      // Anchor: -U must come AFTER -w, as a single command
      const wIndex = keychainArgs.indexOf("-w");
      const uIndex = keychainArgs.indexOf("-U");
      expect(wIndex).toBeGreaterThanOrEqual(0);
      expect(uIndex).toBeGreaterThanOrEqual(0);
      expect(uIndex).toBeGreaterThan(wIndex); // -U appears after secret value

      // Shape test: verify the command is a single atomic upsert, not delete+add pattern
      expect(keychainArgs).toContain("add-generic-password");
      expect(keychainArgs).not.toContain("delete-generic-password");
    });

    it("rotates token correctly (old is replaced atomically)", () => {
      const mockExec = vi.fn();

      // Simulate Microsoft's rotating refresh token behavior
      persistSecretToKeychain("bing-refresh", "old-token-abc123", mockExec);
      expect(mockExec).toHaveBeenCalledTimes(1);

      persistSecretToKeychain("bing-refresh", "new-token-def456", mockExec);
      expect(mockExec).toHaveBeenCalledTimes(2);

      // Both calls should use the atomic -U upsert
      for (const call of mockExec.mock.calls) {
        const args = call[1] as string[];
        expect(args).toContain("-U");
      }
    });

    it("passes service name correctly to keychain", () => {
      const mockExec = vi.fn();
      persistSecretToKeychain("bing-refresh", "token123", mockExec);

      const keychainArgs = mockExec.mock.calls[0][1] as string[];
      const sIndex = keychainArgs.indexOf("-s");
      expect(keychainArgs[sIndex + 1]).toBe("bing-refresh");
    });
  });
});
