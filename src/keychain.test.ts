import { describe, it, expect, vi } from "vitest";
import { buildKeychainUpsertArgs, persistSecretToKeychain } from "./keychain.js";

// The bug class plain unit tests miss here: a future edit reintroducing the
// delete-then-add rotation, which lost the refresh token if the process died
// between the two calls (this happened in prod 2026-06). The anchor tests pin
// the two invariants that prevent it: the write is a single call, and it never
// issues a delete.
describe("keychain refresh-token persistence", () => {
  // ---- unit
  it("builds an add-generic-password upsert carrying service + secret + -U", () => {
    const args = buildKeychainUpsertArgs("BING_ADS_REFRESH_TOKEN", "secret123");
    expect(args[0]).toBe("add-generic-password");
    expect(args).toContain("-U");
    expect(args).toContain("BING_ADS_REFRESH_TOKEN");
    expect(args).toContain("secret123");
    expect(args).toContain("bing-ads-mcp");
  });

  // ---- anchor: NEVER delete (regardless of service name) — guards the exact bug
  it("never issues a delete-generic-password", () => {
    for (const svc of ["BING_ADS_REFRESH_TOKEN", "ANYTHING_ELSE"]) {
      expect(buildKeychainUpsertArgs(svc, "x")).not.toContain("delete-generic-password");
    }
  });

  // ---- anchor: exactly ONE security call — no delete+add absence window
  it("persists via exactly one atomic security call", () => {
    const exec = vi.fn();
    const ok = persistSecretToKeychain("BING_ADS_REFRESH_TOKEN", "tok", exec);
    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(
      "security",
      expect.arrayContaining(["add-generic-password", "-U"]),
    );
  });

  // ---- behavior: a failed write degrades gracefully, never throws
  it("returns false (does not throw) when the keychain write fails", () => {
    const exec = vi.fn(() => {
      throw new Error("keychain locked / ACL denied");
    });
    expect(persistSecretToKeychain("BING_ADS_REFRESH_TOKEN", "tok", exec)).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
