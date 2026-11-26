// The real callback server, over loopback. The token endpoint and the token
// store are both injected, so nothing leaves the machine or touches a Keychain.
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { startCallbackServer } = require("../get-refresh-token.cjs");

const REFRESH = "FAKE-refresh-Zq7Wm2Kp9Xv4Bn6Tj1Hd8Rs3Lf5Gc0Ya";
const ACCESS = "FAKE-access-Pu3Ek8Nw1Oi6Ma9Dz2Fx7Cb4Vq5Jt0Sr";
const ID_TOKEN = `x.${Buffer.from(JSON.stringify({ preferred_username: "someone@example.com" })).toString("base64")}.y`;

/** No 8-character run of a token may appear: a prefix is a leak too. */
function expectNoTokenFragment(text: string) {
  for (const token of [REFRESH, ACCESS]) {
    for (let i = 0; i + 8 <= token.length; i++) expect(text).not.toContain(token.slice(i, i + 8));
  }
}

async function callback(tokenReply: () => Promise<any>, stored: any = { where: "keychain" }) {
  const logs: string[] = [];
  const store = vi.fn(() => stored);
  let done: (code: number) => void;
  const exit = new Promise<number>((r) => (done = r));
  const servers = await startCallbackServer({
    port: 0,
    clientId: "client-id",
    deps: { fetch: tokenReply, store, log: (...a: unknown[]) => logs.push(a.map(String).join(" ")), done: (c: number) => done(c) },
  });
  const addresses = servers.map((s: any) => s.address().address);
  const res = await fetch(`http://127.0.0.1:${servers[0].address().port}/callback?code=abc`, {
    headers: { connection: "close" },
  });
  const body = await res.text();
  const code = await exit;
  await Promise.all(servers.map((s: any) => new Promise((r) => s.close(r))));
  return { printed: logs.join("\n"), body, status: res.status, code, store, addresses };
}

const json = (value: unknown) => async () => ({ status: 200, json: async () => value });

describe("get-refresh-token callback server", () => {
  it("listens on loopback only", async () => {
    const { addresses } = await callback(json({ refresh_token: REFRESH }));
    expect(addresses).toContain("127.0.0.1");
    for (const a of addresses) expect(["127.0.0.1", "::1"]).toContain(a);
  });

  it("stores the refresh token and prints neither it nor a prefix", async () => {
    const r = await callback(json({ refresh_token: REFRESH, access_token: ACCESS, id_token: ID_TOKEN }));

    expect(r.store).toHaveBeenCalledWith({ account: "bing-ads-mcp", service: "BING_ADS_REFRESH_TOKEN", secret: REFRESH });
    expect(r.printed).toContain("someone@example.com");
    expect(r.printed).toContain("BING_ADS_REFRESH_TOKEN");
    expectNoTokenFragment(r.printed + r.body);
    expect([r.status, r.code]).toEqual([200, 0]);
  });

  it("reports a failed save as a failure, still without the token", async () => {
    const r = await callback(json({ refresh_token: REFRESH }), { where: null, error: "EACCES" });

    expect(r.printed).toMatch(/NOT saved/);
    expectNoTokenFragment(r.printed + r.body);
    expect([r.status, r.code]).toEqual([500, 1]);
  });

  it("does not dump a reply that has an access token but no refresh token", async () => {
    const r = await callback(json({ access_token: ACCESS, token_type: "Bearer" }));

    expect(r.printed).toContain("access_token, token_type");
    expectNoTokenFragment(r.printed + r.body);
    expect(r.store).not.toHaveBeenCalled();
    expect([r.status, r.code]).toEqual([500, 1]);
  });

  it("shows the OAuth error and its description", async () => {
    const r = await callback(json({ error: "invalid_grant", error_description: "code expired" }));
    expect(r.printed).toContain("invalid_grant: code expired");
    expect(r.body).toContain("invalid_grant: code expired");
  });

  // A JSON parse error quotes the body it failed on.
  it("does not quote an unparseable reply", async () => {
    const r = await callback(async () => ({ status: 502, json: async () => JSON.parse(REFRESH) }));

    expect(r.printed).toMatch(/not JSON/);
    expectNoTokenFragment(r.printed + r.body);
    expect(r.code).toBe(1);
  });
});
