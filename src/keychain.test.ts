// Every call here injects the runner, so the real `security` binary is never run.
import { describe, it, expect, vi } from "vitest";
import {
  buildKeychainUpsertCommand,
  persistSecretToKeychain,
  KEYCHAIN_ACCOUNT,
  MAX_COMMAND_BYTES,
} from "./keychain";

const ok = () => vi.fn(() => ({ status: 0 }));
const commandFor = (secret: string) =>
  `add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "svc" -w "${secret}" -U\n`;
/** A secret that makes the command line exactly `bytes` long. */
const secretForLineOf = (bytes: number) => "a".repeat(bytes - Buffer.byteLength(commandFor("")));

describe("keychain token persistence", () => {
  it("uses this server's Keychain account", () => {
    expect(KEYCHAIN_ACCOUNT).toBe("bing-ads-mcp");
  });

  it("writes through `security -i`, with the secret on stdin and never in the arguments", () => {
    const run = ok();

    expect(persistSecretToKeychain("svc", "FAKE!token*with$punct", run)).toBe(true);

    expect(run).toHaveBeenCalledTimes(1);
    const [file, args, opts] = run.mock.calls[0] as any[];
    expect([file, args]).toEqual(["security", ["-i"]]);
    expect(opts.input).toBe(commandFor("FAKE!token*with$punct"));
    // security quotes its input in error messages, so its output is discarded.
    expect(opts.stdio).toEqual(["pipe", "ignore", "ignore"]);
  });

  // Delete-then-add can lose a rotating token if the second call never happens.
  it("upserts in one command (-U) and never deletes first", () => {
    const command = buildKeychainUpsertCommand("svc", "new-token")!;
    expect(command).toMatch(/^add-generic-password .* -U\n$/);
    expect(command).not.toContain("delete-generic-password");
  });

  it("allows an account override", () => {
    expect(buildKeychainUpsertCommand("svc", "s", "other")).toContain('-a "other"');
  });

  it.each([[{ status: 45 }], [{ status: null }]])("returns false when security exits %j", (result) => {
    expect(persistSecretToKeychain("svc", "token", () => result)).toBe(false);
  });

  it("returns false, without throwing, when security cannot be started", () => {
    const run = () => {
      throw new Error("ENOENT");
    };
    expect(persistSecretToKeychain("svc", "token", run)).toBe(false);
  });

  // `security -i` splits a line longer than its 4096-byte buffer and runs the
  // first piece on its own, which stores a truncated secret in the default
  // Keychain. Such a line must never reach it.
  describe("line length", () => {
    it("stays under security's buffer", () => {
      expect(MAX_COMMAND_BYTES).toBeLessThan(4096);
    });

    it("sends a line of exactly the limit", () => {
      const run = ok();
      expect(persistSecretToKeychain("svc", secretForLineOf(MAX_COMMAND_BYTES), run)).toBe(true);
      expect(Buffer.byteLength((run.mock.calls[0] as any[])[2].input)).toBe(MAX_COMMAND_BYTES);
    });

    it("never runs security for a line one byte over", () => {
      const run = ok();
      expect(persistSecretToKeychain("svc", secretForLineOf(MAX_COMMAND_BYTES + 1), run)).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it("counts bytes, not characters", () => {
      const run = ok();
      const secret = "é".repeat(2100); // 2100 characters, 4200 bytes
      expect(persistSecretToKeychain("svc", secret, run)).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });
  });

  it.each([['a"b'], ["a\\b"], ["a\nb"], ["a\rb"], ["a\0b"]])(
    "never runs security for a value that would break out of its quotes (%j)",
    (secret) => {
      const run = ok();
      expect(persistSecretToKeychain("svc", secret, run)).toBe(false);
      expect(persistSecretToKeychain(secret, "token", run)).toBe(false);
      expect(run).not.toHaveBeenCalled();
    },
  );
});
