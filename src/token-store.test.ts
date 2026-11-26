// Every test injects `platform`, `spawn` and `dir`, so none can reach a real
// Keychain or a real home directory.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";

const require = createRequire(import.meta.url);
const { storeToken, describeStored, listenLoopback, MAX_COMMAND_BYTES } = require("../token-store.cjs");

const SECRET = "FAKE-secret!with*punct$-0123456789abcdef";
const ENTRY = { account: "acct", service: "SERVICE_NAME", secret: SECRET };
const posixIt = process.platform === "win32" ? it.skip : it;

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "token-store-"));
  dirs.push(d);
  return join(d, "store");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("storeToken on macOS", () => {
  it("sends the secret to `security -i` on stdin, never in the arguments", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    const dir = tmp();
    const result = storeToken(ENTRY, { platform: "darwin", spawn, dir });

    expect(result).toEqual({ where: "keychain" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0] as any[];
    expect(cmd).toBe("security");
    expect(args).toEqual(["-i"]);
    expect(opts.input).toBe(`add-generic-password -a "acct" -s "SERVICE_NAME" -w "${SECRET}" -U\n`);
    // security echoes its input in error messages, so its output is discarded.
    expect(opts.stdio).toEqual(["pipe", "ignore", "ignore"]);
    expect(existsSync(dir)).toBe(false);
  });

  it("falls back to a file when the Keychain write fails", () => {
    const dir = tmp();
    const result = storeToken(ENTRY, { platform: "darwin", spawn: () => ({ status: 45 }), dir });

    expect(result).toEqual({ where: "file", path: join(dir, "SERVICE_NAME"), keychainFailed: true });
    expect(readFileSync(result.path, "utf8")).toBe(SECRET);
  });

  // `security -i` splits a line longer than its 4096-byte buffer and runs the
  // first piece alone, which stores a truncated secret in the default Keychain.
  it("never hands `security` an over-long line", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    const secret = "a".repeat(MAX_COMMAND_BYTES);
    const result = storeToken({ ...ENTRY, secret }, { platform: "darwin", spawn, dir: tmp() });

    expect(MAX_COMMAND_BYTES).toBeLessThan(4096);
    expect(spawn).not.toHaveBeenCalled();
    expect(result.where).toBe("file");
    expect(readFileSync(result.path, "utf8")).toBe(secret);
  });

  it.each([['a"b'], ["a\\b"], ["a\nb"], ["a\rb"], ["a\0b"]])(
    "never hands `security` a value that would break out of its quotes (%j)",
    (secret) => {
      const spawn = vi.fn(() => ({ status: 0 }));
      const result = storeToken({ ...ENTRY, secret }, { platform: "darwin", spawn, dir: tmp() });

      expect(spawn).not.toHaveBeenCalled();
      expect(result.where).toBe("file");
    },
  );
});

describe("storeToken file fallback", () => {
  it("writes a file and never calls `security` off macOS", () => {
    const spawn = vi.fn();
    const dir = tmp();
    const result = storeToken(ENTRY, { platform: "linux", spawn, dir });

    expect(spawn).not.toHaveBeenCalled();
    expect(result).toEqual({ where: "file", path: join(dir, "SERVICE_NAME"), keychainFailed: false });
    expect(readFileSync(result.path, "utf8")).toBe(SECRET);
  });

  posixIt("makes the file and its directory owner-only, even if they already existed looser", () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    writeFileSync(join(dir, "SERVICE_NAME"), "old");
    chmodSync(join(dir, "SERVICE_NAME"), 0o644);

    const result = storeToken(ENTRY, { platform: "linux", dir });

    expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(result.path, "utf8")).toBe(SECRET);
  });

  posixIt("replaces a symlink instead of writing through it", () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const elsewhere = join(dir, "..", "elsewhere");
    writeFileSync(elsewhere, "untouched");
    symlinkSync(elsewhere, join(dir, "SERVICE_NAME"));

    storeToken(ENTRY, { platform: "linux", dir });

    expect(readFileSync(elsewhere, "utf8")).toBe("untouched");
  });

  it.each([["../escape"], ["a/b"], [".."], ["."], [""]])("refuses %j as a file name", (service) => {
    const result = storeToken({ ...ENTRY, service }, { platform: "linux", dir: tmp() });
    expect(result.where).toBeNull();
  });

  it("reports failure without the secret when nothing can be written", () => {
    const dir = tmp();
    writeFileSync(dir, "a file where the directory should be");
    const result = storeToken(ENTRY, { platform: "linux", dir });

    expect(result.where).toBeNull();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("describeStored", () => {
  const entry = { account: "acct", service: "SERVICE_NAME", envVar: "THE_ENV_VAR" };

  it("says how to load a Keychain entry without displaying it", () => {
    const text = describeStored({ where: "keychain" }, entry);
    expect(text).toContain(`export THE_ENV_VAR="$(security find-generic-password -a acct -s SERVICE_NAME -w)"`);
  });

  it("names the file and how to load it, and warns that an older Keychain entry remains", () => {
    const text = describeStored({ where: "file", path: "/tmp/x/SERVICE_NAME", keychainFailed: true }, entry);
    expect(text).toContain("/tmp/x/SERVICE_NAME");
    expect(text).toContain(`export THE_ENV_VAR="$(cat '/tmp/x/SERVICE_NAME')"`);
    expect(text).toMatch(/older Keychain entry/);
  });

  it("says the token was not saved", () => {
    expect(describeStored({ where: null, error: "ENOTDIR" }, entry)).toMatch(/NOT saved.*ENOTDIR/s);
  });
});

describe("listenLoopback", () => {
  const close = (servers: any[]) => Promise.all(servers.map((s) => new Promise((r) => s.close(r))));

  it("binds only loopback addresses, IPv4 always among them", async () => {
    const servers = await listenLoopback(() => http.createServer(), 0);
    const addresses = servers.map((s: any) => s.address().address);
    await close(servers);

    expect(addresses).toContain("127.0.0.1");
    for (const a of addresses) expect(["127.0.0.1", "::1"]).toContain(a);
  });

  it("fails when the port is already taken, so the code cannot reach another process", async () => {
    const squatter = net.createServer();
    await new Promise<void>((r) => squatter.listen(0, "127.0.0.1", r));
    const { port } = squatter.address() as net.AddressInfo;

    await expect(listenLoopback(() => http.createServer(), port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    await close([squatter]);
  });
});
