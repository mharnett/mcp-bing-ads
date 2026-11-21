/**
 * bing_ads_update_ad_group_cpc_bid at the call site: the expected-bid
 * precondition before the write and the read-back after it.
 *
 * Both checks live in BingAdsManager.updateAdGroupCpcBid() in src/index.ts,
 * which no test could import, so only the pure helpers in
 * mutationRequests.ts were covered (review 2026-11-14). This drives the real
 * tool through the server with writes on and a fake API that controls what
 * the before and after reads return.
 *
 * Containment: same recording fetch, keychain and config fakes as
 * writeGate.callSite.test.ts. Nothing reaches Microsoft Advertising.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createRecordingFetch, FAKE_ACCOUNT_ID, FAKE_ENV, type RecordedRequest } from "../tests/helpers/fakeBingApi.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";

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
});

const AD_GROUP = "400";
const NAME = "Widgets - Phrase";

/** Answer the before read with `before`, the write with success, the after read with `after`. */
function bidsReadAs(before: number | undefined, after: number | undefined) {
  let reads = 0;
  api.setRoute((req: RecordedRequest) => {
    if (req.path === "/AdGroups/QueryByCampaignId") {
      const amount = reads++ === 0 ? before : after;
      const adGroups = amount === undefined ? [] : [{ Id: Number(AD_GROUP), Name: NAME, CpcBid: { Amount: amount } }];
      return { status: 200, body: { AdGroups: adGroups } };
    }
    if (req.method === "PUT" && req.path === "/AdGroups") return { status: 200, body: { PartialErrors: [] } };
    return { status: 404, body: { error: `unexpected ${req.method} ${req.path}` } };
  });
}

function callBid(extra: Record<string, unknown> = {}) {
  return client.callTool({
    name: "bing_ads_update_ad_group_cpc_bid",
    arguments: { account_id: FAKE_ACCOUNT_ID, campaign_id: "300", ad_group_id: AD_GROUP, cpc_bid: 2.5, expected_current_bid: 2.0, ...extra },
  }) as Promise<any>;
}

const sequence = () => api.apiRequests.map((r) => `${r.method} ${r.path}`);

describe("bing_ads_update_ad_group_cpc_bid", () => {
  it("reads, writes, reads back, and reports the verified bid when it took", async () => {
    bidsReadAs(2.0, 2.5);

    const result = await callBid();

    expect(result.isError).toBeFalsy();
    expect(bodyOf(result)._verified).toEqual({ ad_group_id: AD_GROUP, ad_group_name: NAME, previous_bid: 2.0, new_bid: 2.5 });
    expect(sequence()).toEqual(["POST /AdGroups/QueryByCampaignId", "PUT /AdGroups", "POST /AdGroups/QueryByCampaignId"]);
    expect(api.apiRequests[1].body.AdGroups[0].CpcBid.Amount).toBe(2.5);
  });

  it("fails when the API reports success but the read-back bid is unchanged", async () => {
    bidsReadAs(2.0, 2.0);

    const result = await callBid();

    expect(result.isError).toBe(true);
    expect(bodyOf(result).message).toMatch(/CPC bid write did NOT take on ad group 400: asked for 2.5, read back 2\b/);
  });

  it("fails when the ad group is missing from the read-back", async () => {
    bidsReadAs(2.0, undefined);

    const result = await callBid();

    expect(result.isError).toBe(true);
    expect(bodyOf(result).message).toMatch(/did NOT take.*read back undefined/);
  });

  it("refuses to write when the live bid differs from expected_current_bid", async () => {
    bidsReadAs(3.0, 2.5);

    const result = await callBid();

    expect(result.isError).toBe(true);
    expect(bodyOf(result).message).toMatch(/Bid precondition failed .* expected 2, found 3/);
    expect(sequence()).toEqual(["POST /AdGroups/QueryByCampaignId"]);
  });

  it("refuses without any request when expected_current_bid is missing", async () => {
    bidsReadAs(2.0, 2.5);

    const result = await callBid({ expected_current_bid: undefined });

    expect(result.isError).toBe(true);
    expect(bodyOf(result).error).toMatch(/expected_current_bid is required/);
    expect(api.total).toBe(0);
  });
});
