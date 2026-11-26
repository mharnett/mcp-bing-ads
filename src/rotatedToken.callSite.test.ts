/**
 * A rotated refresh token is saved without appearing in a process argument or
 * a log line. This drives a real tool call through the server's token refresh.
 *
 * Containment: child_process is replaced by recorders that never start a
 * process, so the real `security` binary is not run. fetch is a fake, so
 * nothing reaches Microsoft Advertising. process.platform is set to darwin so the
 * Keychain branch runs on every OS.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createRecordingFetch, FAKE_ENV } from "../tests/helpers/fakeBingApi.js";
import { connectInMemory } from "../tests/helpers/connect.js";
import { logger } from "./resilience.js";

const runner = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[]; input?: string }[],
  fails: false,
}));

vi.mock("child_process", async (importOriginal) => {
  const record = (file: string, args: string[] = [], opts: any = {}) => {
    runner.calls.push({ file, args, input: opts.input });
  };
  const refuse = () => {
    throw new Error("no process may be started in this test");
  };
  return {
    ...(await importOriginal<typeof import("child_process")>()),
    spawnSync: (file: string, args: string[], opts: any) => {
      record(file, args, opts);
      return { status: runner.fails ? 45 : 0 };
    },
    // Fails the way Node does: the message repeats the whole command line.
    execFileSync: (file: string, args: string[], opts: any) => {
      record(file, args, opts);
      if (runner.fails) {
        throw Object.assign(new Error(`Command failed: ${file} ${args.join(" ")}`), { status: 45 });
      }
      return Buffer.from("");
    },
    spawn: refuse,
    exec: refuse,
    execFile: refuse,
    execSync: refuse,
  };
});
vi.mock("./config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./config.js")>();
  return { ...real, resolveConfig: (opts: any) => real.resolveConfig({ ...opts, exists: () => false }) };
});

const api = createRecordingFetch();
const tokenBodies: string[] = [];
let nextRefreshToken = "";
const logged: unknown[] = [];
let client: Client;
const realPlatform = process.platform;

const setPlatform = (value: string) => Object.defineProperty(process, "platform", { value, configurable: true });

/** Everything logged, errors expanded: their message and stack are not enumerable. */
const logText = () =>
  JSON.stringify(logged, (_key, v) => (v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v));

/** No 8-character run of the token may appear: a prefix is a leak too. */
function expectNoTokenFragment(text: string, token: string) {
  for (let i = 0; i + 8 <= token.length; i++) expect(text).not.toContain(token.slice(i, i + 8));
}

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    if (/oauth/i.test(String(input))) {
      tokenBodies.push(String(init.body));
      // expires_in 0: every tool call refreshes again.
      return new Response(
        JSON.stringify({ access_token: "fake-access-token", refresh_token: nextRefreshToken, expires_in: 0 }),
        { status: 200 },
      );
    }
    return api.fetch(input, init);
  });
  for (const [k, v] of Object.entries({ ...FAKE_ENV, ...{} })) vi.stubEnv(k, v);
  for (const method of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(logger, method).mockImplementation(((...args: unknown[]) => void logged.push(args)) as any);
  }
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args));
  const { server } = await import("./index.js");
  client = await connectInMemory(server);
  setPlatform("darwin");
});

afterAll(async () => {
  setPlatform(realPlatform);
  await client?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  runner.calls.length = 0;
  runner.fails = false;
  logged.length = 0;
  api.reset();
});

async function callToolRotatingTo(refreshToken: string): Promise<any> {
  nextRefreshToken = refreshToken;
  const result: any = await client.callTool({ name: "bing_ads_list_campaigns", arguments: { account_id: FAKE_ENV.BING_ADS_ACCOUNT_ID } });
  expect(result.isError, result.content[0].text).toBeFalsy();
  return result;
}

describe("a rotated refresh token", () => {
  it("is saved by one `security -i` run, on stdin, with nothing secret in the arguments", async () => {
    const token = "Zq7Wm2Kp9Xv4Bn6Tj1Hd8Rs3Lf5Gc0Ya";
    await callToolRotatingTo(token);

    expect(runner.calls).toEqual([
      {
        file: "security",
        args: ["-i"],
        input: `add-generic-password -a "bing-ads-mcp" -s "BING_ADS_REFRESH_TOKEN" -w "${token}" -U\n`,
      },
    ]);
    expectNoTokenFragment(logText(), token);
  });

  it("is not logged when the Keychain write fails", async () => {
    const token = "Pu3Ek8Nw1Oi6Ma9Dz2Fx7Cb4Vq5Jt0Sr";
    runner.fails = true;
    await callToolRotatingTo(token);

    expect(logText()).toMatch(/Failed to persist rotated refresh token/);
    expectNoTokenFragment(logText(), token);
  });

  it("too long for one stdin line never reaches security, and still serves this session", async () => {
    const token = "Hk4".repeat(1700); // 5100 bytes
    await callToolRotatingTo(token);

    expect(runner.calls).toEqual([]);
    expect(logText()).toMatch(/Failed to persist rotated refresh token/);
    expectNoTokenFragment(logText(), token);

    await callToolRotatingTo("Vb8Yc2Lm5Qx9Rt1Ws4Dn7Gj0Kp3Fh6Za");
    expect(new URLSearchParams(tokenBodies.at(-1)!).get("refresh_token")).toBe(token);
  });
});
