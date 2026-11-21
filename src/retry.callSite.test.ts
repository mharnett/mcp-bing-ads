/**
 * Non-idempotent writes must not be retried.
 *
 * withResilience() retries any transient failure (5xx, network error,
 * timeout) up to three more times. bing_ads_add_shared_negatives is a POST
 * that appends to a shared list, so a 5xx after Microsoft stored the items
 * would send them again. It goes out once. The PUT writes set absolute values
 * and reads change nothing, so they still retry.
 *
 * Containment: same recording fetch, keychain and config fakes as
 * writeGate.callSite.test.ts. Nothing reaches Microsoft Advertising.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createRecordingFetch, FAKE_ACCOUNT_ID, FAKE_ENV } from "../tests/helpers/fakeBingApi.js";
import { connectInMemory } from "../tests/helpers/connect.js";

vi.mock("./keychain.js", () => ({ persistSecretToKeychain: () => false }));
vi.mock("./config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./config.js")>();
  return { ...real, resolveConfig: (opts: any) => real.resolveConfig({ ...opts, exists: () => false }) };
});

const api = createRecordingFetch();
let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", api.fetch);
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("BING_ADS_MCP_WRITE", "true");
  const { server } = await import("./index.js");
  client = await connectInMemory(server);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  api.reset();
  api.setRoute(() => ({ status: 503, body: { error: "Service Unavailable" } }));
});

describe("a write that fails with a 5xx", () => {
  it("bing_ads_add_shared_negatives is sent exactly once", async () => {
    const result: any = await client.callTool({
      name: "bing_ads_add_shared_negatives",
      arguments: { account_id: FAKE_ACCOUNT_ID, shared_list_id: "600", keywords: [{ text: "free widgets" }] },
    });

    expect(result.isError).toBe(true);
    expect(api.apiRequests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /ListItems"]);
  }, 20_000);

  it("bing_ads_pause_keywords (an idempotent PUT) is still retried", async () => {
    const result: any = await client.callTool({
      name: "bing_ads_pause_keywords",
      arguments: { account_id: FAKE_ACCOUNT_ID, ad_group_id: "400", keyword_ids: ["500"] },
    });

    expect(result.isError).toBe(true);
    expect(api.apiRequests.length).toBeGreaterThan(1);
  }, 20_000);
});
